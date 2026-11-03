import { useEffect, useState } from "react";
import {
  defaultToolRadialMenuConfig,
  normalizeToolRadialMenuConfig,
  type ToolRadialMenuConfig
} from "./toolRadialMenu";

export type ToolRadialSettingsApi = {
  getToolRadialMenu?: () => Promise<unknown>;
  setToolRadialMenu?: (config: unknown) => Promise<unknown>;
};

export const loadToolRadialMenuConfig = async (
  api: ToolRadialSettingsApi
): Promise<ToolRadialMenuConfig> => {
  if (!api.getToolRadialMenu) {
    return defaultToolRadialMenuConfig();
  }

  try {
    return normalizeToolRadialMenuConfig(await api.getToolRadialMenu());
  } catch {
    return defaultToolRadialMenuConfig();
  }
};

export const saveToolRadialMenuConfig = async (
  api: ToolRadialSettingsApi | undefined,
  nextConfig: unknown,
  callbacks: {
    setConfig: (config: ToolRadialMenuConfig) => void;
    setStatus: (status: string) => void;
  }
): Promise<ToolRadialMenuConfig> => {
  const normalized = normalizeToolRadialMenuConfig(nextConfig);
  callbacks.setConfig(normalized);

  try {
    await api?.setToolRadialMenu?.(normalized);
  } catch {
    callbacks.setStatus("Could not save radial shortcut settings");
  }

  return normalized;
};

export const useToolRadialSettingsController = ({
  setStatus
}: {
  setStatus: (status: string) => void;
}) => {
  const [toolRadialMenuConfig, setToolRadialMenuConfig] = useState<ToolRadialMenuConfig>(() =>
    defaultToolRadialMenuConfig()
  );

  useEffect(() => {
    let cancelled = false;

    void loadToolRadialMenuConfig(window.storyboard ?? {}).then((config) => {
      if (!cancelled) {
        setToolRadialMenuConfig(config);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistToolRadialMenuConfig = (nextConfig: ToolRadialMenuConfig) => {
    void saveToolRadialMenuConfig(window.storyboard, nextConfig, {
      setConfig: setToolRadialMenuConfig,
      setStatus
    });
  };

  return {
    toolRadialMenuConfig,
    persistToolRadialMenuConfig
  };
};
