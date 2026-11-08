//! Bounded read-only output metadata overlay. Source XMP outside the one Flow
//! property is retained byte-for-byte; this is never a persistent Document edit.
use super::source_metadata::{FLOW_NS, MAX_METADATA, MAX_XMP, RDF_NS, XMP_NS, parse_xmp};
use super::*;
use base64::Engine;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataRef {
    pub sha256: String,
    pub byte_length: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    schema: String,
    version: u32,
    project_id: String,
    revision: u64,
    shot_id: String,
    image_id: String,
    metadata: Metadata,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    project_name: String,
    shot_name: String,
    script_text: String,
    dialogues: Vec<Dialogue>,
    presentation: NullablePresentation,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum NullablePresentation {
    Value(Presentation),
    Null(()),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Dialogue {
    id: String,
    shot_id: String,
    text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Presentation {
    mode: Mode,
    dialogue: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Expanded,
    Embedded,
}
fn refused(message: impl Into<String>) -> Error {
    Error::none("output-metadata-refused", message)
}
fn validate(bytes: &[u8], reference: &MetadataRef) -> Result<()> {
    if bytes.is_empty()
        || bytes.len() > MAX_METADATA
        || reference.byte_length != bytes.len()
        || !store::is_hash(&reference.sha256)
        || reference.sha256 != sha(bytes)
    {
        return Err(refused(
            "output metadata digest, length or 1MiB budget mismatch",
        ));
    }
    let e: Envelope = serde_json::from_slice(bytes)
        .map_err(|e| refused(format!("invalid versioned output metadata: {e}")))?;
    if e.schema != "flow.native-output-metadata"
        || e.version != 2
        || e.revision > 9_007_199_254_740_991
    {
        return Err(refused(
            "unsupported output metadata schema/version/revision",
        ));
    }
    for id in [&e.project_id, &e.shot_id, &e.image_id] {
        valid_id(id).map_err(|_| refused("invalid output identity"))?;
    }
    let mut ids = std::collections::HashSet::new();
    for d in &e.metadata.dialogues {
        valid_id(&d.id).map_err(|_| refused("invalid dialogue identity"))?;
        if d.shot_id != e.shot_id || !ids.insert(&d.id) {
            return Err(refused("dialogue ownership or unique identity mismatch"));
        }
        let _ = &d.text;
    }
    let _ = (
        &e.metadata.project_name,
        &e.metadata.shot_name,
        &e.metadata.script_text,
    );
    if let NullablePresentation::Value(p) = &e.metadata.presentation {
        let _ = (&p.mode, p.dialogue);
    }
    Ok(())
}
fn property(bytes: &[u8]) -> String {
    format!(
        "<rdf:Description xmlns:rdf=\"{RDF_NS}\" xmlns:flow=\"{FLOW_NS}\"><flow:metadata>{}</flow:metadata></rdf:Description>",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
pub(super) fn merge_xmp(source: Option<&str>, bytes: &[u8]) -> Result<String> {
    let property = property(bytes);
    let Some(source) = source else {
        return Ok(format!(
            "<x:xmpmeta xmlns:x=\"{XMP_NS}\"><rdf:RDF xmlns:rdf=\"{RDF_NS}\">{property}</rdf:RDF></x:xmpmeta>"
        ));
    };
    let parsed = parse_xmp(source)?;
    let rdf = parsed
        .descendants()
        .filter(|n| n.has_tag_name((RDF_NS, "RDF")))
        .collect::<Vec<_>>();
    if rdf.len() != 1 {
        return Err(refused("source XMP requires one unambiguous RDF container"));
    }
    let rdf = rdf[0];
    let mut removals = Vec::new();
    for node in parsed.descendants().filter(|n| n.is_element()) {
        if node.has_tag_name((FLOW_NS, "metadata")) {
            if !node
                .parent()
                .is_some_and(|p| p.has_tag_name((RDF_NS, "Description")) && p.parent() == Some(rdf))
                || node.children().any(|c| c.is_element())
                || node.attributes().len() != 0
            {
                return Err(refused("source Flow metadata has an ambiguous XML shape"));
            }
            removals.push(node.range());
        }
        for attr in node
            .attributes()
            .filter(|a| a.namespace() == Some(FLOW_NS) && a.name() == "metadata")
        {
            if !node.has_tag_name((RDF_NS, "Description")) || node.parent() != Some(rdf) {
                return Err(refused(
                    "source Flow metadata attribute has an ambiguous owner",
                ));
            }
            removals.push(attr.range());
        }
    }
    if removals.len() > 1 {
        return Err(refused(
            "source XMP contains duplicate Flow metadata properties",
        ));
    }
    let range = rdf.range();
    let fragment = &source[range.clone()];
    let mut edits = removals
        .into_iter()
        .map(|r| (r, String::new()))
        .collect::<Vec<_>>();
    if fragment.ends_with("/>") {
        // Preserve attributes, namespace declarations, prefixes and all other
        // packet bytes, including wrappers and processing instructions.
        let qname = fragment[1..]
            .split(|c: char| c.is_whitespace() || c == '/' || c == '>')
            .next()
            .ok_or_else(|| refused("source RDF name missing"))?;
        edits.push((
            range.start + fragment.len() - 2..range.end,
            format!(">{property}</{qname}>"),
        ));
    } else {
        let close = fragment
            .rfind("</")
            .ok_or_else(|| refused("source RDF closing tag missing"))?
            + range.start;
        edits.push((close..close, property));
    }
    edits.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
    let mut result = source.to_string();
    for (range, text) in edits {
        result.replace_range(range, &text);
    }
    if result.len() > MAX_XMP {
        return Err(refused("merged output XMP exceeds 2MiB"));
    }
    parse_xmp(&result)?;
    Ok(result)
}
pub(super) fn overlay(doc: &Document, reference: &MetadataRef, bytes: &[u8]) -> Result<Document> {
    validate(bytes, reference)?;
    let xmp = merge_xmp(doc.metadata.xmp.as_deref(), bytes)?;
    let mut copy = doc.clone();
    copy.metadata.xmp = Some(Arc::from(xmp));
    Ok(copy)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Vec<u8> {
        serde_json::to_vec(&json!({"schema":"flow.native-output-metadata","version":2,"projectId":"project","revision":7,"shotId":"shot","imageId":"image","metadata":{"projectName":"项目","shotName":"镜头","scriptText":"text <&>","dialogues":[{"id":"line","shotId":"shot","text":"对白"}],"presentation":{"mode":"expanded","dialogue":true}}})).unwrap()
    }
    fn reference(bytes: &[u8]) -> MetadataRef {
        MetadataRef {
            sha256: sha(bytes),
            byte_length: bytes.len(),
        }
    }
    #[test]
    fn unknown_xmp_and_wrappers_remain_byte_exact_while_flow_attribute_is_replaced() {
        let source = format!(
            "<?xpacket begin='test'?>\n<x:xmpmeta xmlns:x='{XMP_NS}'><q:RDF xmlns:q='{RDF_NS}'><q:Description xmlns:f='{FLOW_NS}' xmlns:u='urn:unknown' u:unknown='A &amp; B' f:metadata='old'><u:tree a='1'><u:item>原文</u:item></u:tree></q:Description></q:RDF></x:xmpmeta>\n<?xpacket end='w'?>"
        );
        let merged = merge_xmp(Some(&source), &sample()).unwrap();
        for original in [
            "<?xpacket begin='test'?>",
            "u:unknown='A &amp; B'",
            "<u:tree a='1'><u:item>原文</u:item></u:tree>",
            "<?xpacket end='w'?>",
        ] {
            assert!(merged.contains(original));
        }
        assert!(!merged.contains("f:metadata='old'"));
        assert_eq!(
            parse_xmp(&merged)
                .unwrap()
                .descendants()
                .filter(|n| n.has_tag_name((FLOW_NS, "metadata")))
                .count(),
            1
        );
        let empty =
            format!("<x:xmpmeta xmlns:x='{XMP_NS}'><q:RDF xmlns:q='{RDF_NS}' /></x:xmpmeta>");
        assert!(merge_xmp(Some(&empty), &sample()).is_ok());
    }
    #[test]
    fn existing_flow_element_replaced_without_dropping_other_flow_properties() {
        let source = format!(
            "<r:RDF xmlns:r='{RDF_NS}' xmlns:f='{FLOW_NS}'><r:Description><f:metadata>old</f:metadata><f:another>keep</f:another></r:Description></r:RDF>"
        );
        let merged = merge_xmp(Some(&source), &sample()).unwrap();
        assert!(!merged.contains(">old<"));
        assert!(merged.contains("<f:another>keep</f:another>"));
        let duplicate = source.replace(
            "<f:another>keep</f:another>",
            "<f:metadata>two</f:metadata>",
        );
        assert!(merge_xmp(Some(&duplicate), &sample()).is_err());
        assert!(merge_xmp(Some("<!DOCTYPE x><x/>"), &sample()).is_err());
    }
    #[test]
    fn envelope_bound_identity_and_shape_fail_closed() {
        let bytes = sample();
        validate(&bytes, &reference(&bytes)).unwrap();
        let mut wrong = reference(&bytes);
        wrong.byte_length += 1;
        assert!(validate(&bytes, &wrong).is_err());
        let mut value: Value = serde_json::from_slice(&bytes).unwrap();
        value["metadata"]["dialogues"][0]["shotId"] = json!("wrong");
        let bad = serde_json::to_vec(&value).unwrap();
        assert!(validate(&bad, &reference(&bad)).is_err());
        value["metadata"]
            .as_object_mut()
            .unwrap()
            .remove("presentation");
        let bad = serde_json::to_vec(&value).unwrap();
        assert!(validate(&bad, &reference(&bad)).is_err());
        let big = vec![b'x'; MAX_METADATA + 1];
        assert!(validate(&big, &reference(&big)).is_err());
    }
    #[test]
    fn psd_and_layered_tiff_overlay_preserve_xmp_and_original_document() {
        let mut doc = Document::new("source", Size::new(8, 4), ColorMode::Rgb, SampleType::U8);
        doc.layers.push(Layer::raster("原层", doc.pixel_format()));
        let source = format!(
            "<r:RDF xmlns:r='{RDF_NS}'><r:Description xmlns:u='urn:unknown' u:unchanged='exact'/></r:RDF>"
        );
        doc.metadata.xmp = Some(Arc::from(source.clone()));
        let bytes = sample();
        let exported = overlay(&doc, &reference(&bytes), &bytes).unwrap();
        assert_eq!(doc.metadata.xmp.as_deref(), Some(source.as_str()));
        assert_eq!(doc.layers[0].id, exported.layers[0].id);
        for format in [OutputFormat::Psd, OutputFormat::Tiff] {
            let (receipt, encoded) = output::encode(&exported, &format, wire::MAX_PAYLOAD).unwrap();
            assert_eq!(receipt["layerCount"], 1);
            assert!(!encoded.is_empty());
            if let Some(root) = std::env::var_os("FLOW_OUTPUT_METADATA_EVIDENCE") {
                let root = std::path::PathBuf::from(root);
                std::fs::create_dir_all(&root).unwrap();
                std::fs::write(
                    root.join(match format {
                        OutputFormat::Psd => "unknown-xmp.psd",
                        OutputFormat::Tiff => "unknown-xmp.tiff",
                    }),
                    &encoded,
                )
                .unwrap();
            }
        }
    }
}
