type SidebarState = {
  isAiOpen: boolean;
  isPendingOpen: boolean;
};

export const toggleAiSidebar = ({ isAiOpen }: SidebarState): SidebarState => ({
  isAiOpen: !isAiOpen,
  isPendingOpen: false
});

export const togglePendingSidebar = ({ isPendingOpen }: SidebarState): SidebarState => ({
  isAiOpen: false,
  isPendingOpen: !isPendingOpen
});
