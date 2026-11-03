import { describe, expect, it } from "vitest";
import { createCommitQueue } from "./commitQueue";

type Payload = string[];
type Delivery = { payload: Payload; typing: boolean; id: number };

const same = (a: Payload, b: Payload) => a.length === b.length && a.every((value, index) => value === b[index]);

function harness() {
  const deliveries: Delivery[] = [];
  const replies: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const queue = createCommitQueue<Payload>(same);
  const send = (payload: Payload, typing: boolean, id: number) => {
    deliveries.push({ payload, typing, id });
    return new Promise<void>((resolve, reject) => {
      replies.push({ resolve, reject: () => reject(Error("rejected")) });
    });
  };
  return { queue, deliveries, replies, send };
}

const host = ["a"];
const withB = ["a", "b"];

describe("commit queue", () => {
  it("sends nothing when the text already matches the host", () => {
    const { queue, deliveries, send } = harness();
    expect(queue.publish([...host], true, host, send)).toBe(false);
    expect(deliveries).toHaveLength(0);
  });

  it("sends once for a trailing compositionend input with the same text", () => {
    const { queue, deliveries, send } = harness();
    expect(queue.publish(withB, true, host, send)).toBe(true);
    expect(queue.publish(withB, true, host, send)).toBe(false);
    expect(deliveries).toHaveLength(1);
  });

  it("delivers the revert while an earlier payload is still in flight", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    expect(queue.publish([...host], true, host, send)).toBe(true);
    expect(deliveries.map(item => item.payload)).toEqual([withB, host]);
    expect(queue.unconfirmed()?.id).toBe(2);
    // The first reply may not clear the newer payload, nor the newer request's in-flight marker.
    replies[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()?.id).toBe(2);
    expect(queue.waiting()).toBe(2);
    replies[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
    expect(queue.waiting()).toBeNull();
  });

  it("delivers the revert after the earlier payload was rejected", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    replies[0].reject(Error("rejected"));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()?.payload).toEqual(withB);
    expect(queue.waiting()).toBeNull();
    expect(queue.publish([...host], true, host, send)).toBe(true);
    expect(deliveries.map(item => item.payload)).toEqual([withB, host]);
    replies[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
  });

  it("delivers a revert after success even when the rendered host has not echoed it yet", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    replies[0].resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
    expect(queue.publish([...host], true, host, send)).toBe(true);
    expect(deliveries.map(item => item.payload)).toEqual([withB, host]);
    replies[1].resolve();
    await Promise.resolve();
    expect(queue.publish([...host], true, host, send)).toBe(false);
    expect(queue.retry(withB, send)).toBe(false);
  });

  it("keeps the failed payload as the retry source and re-offers it with its own flag", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    replies[0].reject(Error("rejected"));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.retry(host, send)).toBe(true);
    expect(deliveries[1]).toMatchObject({ payload: withB, typing: true, id: 2 });
    // Repeated retry while awaiting a reply must not queue another request.
    expect(queue.retry(host, send)).toBe(false);
    expect(deliveries).toHaveLength(2);
  });

  it("re-offers text that already matches the host so the older obligation can settle", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    replies[0].reject(Error("rejected"));
    await Promise.resolve();
    await Promise.resolve();
    // Another owner committed the same text, so the retry payload now equals the host. Blur must
    // still deliver it: that no-op commit is what releases this owner's obligation.
    expect(queue.retry([...withB], send)).toBe(true);
    expect(deliveries.map(item => item.payload)).toEqual([withB, withB]);
    expect(deliveries[1].id).toBe(2);
  });

  it("stops retrying once a success confirmed that payload", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    replies[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
    // The host moved on externally; blur has nothing to re-offer.
    expect(queue.retry([...withB, "c"], send)).toBe(false);
    expect(deliveries).toHaveLength(1);
  });

  it("keeps an out-of-order confirmation from clearing the newest payload", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(["a", "1"], true, host, send);
    queue.publish(["a", "2"], true, host, send);
    replies[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()?.payload).toEqual(["a", "2"]);
    expect(queue.retry(host, send)).toBe(false);
    replies[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
    expect(deliveries.map(item => item.id)).toEqual([1, 2]);
  });

  it("does not resurrect a payload when an older rejection lands after a newer success", async () => {
    const { queue, replies, send } = harness();
    queue.publish(["a", "1"], true, host, send);
    queue.publish(["a", "2"], true, host, send);
    replies[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
    replies[0].reject(Error("stale"));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.unconfirmed()).toBeNull();
  });

  it("forgets everything on a history-authority change", async () => {
    const { queue, deliveries, replies, send } = harness();
    queue.publish(withB, true, host, send);
    replies[0].reject(Error("rejected"));
    await Promise.resolve();
    await Promise.resolve();
    queue.reset();
    expect(queue.retry(host, send)).toBe(false);
    expect(queue.publish(withB, true, host, send)).toBe(true);
    expect(deliveries.map(item => item.id)).toEqual([1, 2]);
  });
});
