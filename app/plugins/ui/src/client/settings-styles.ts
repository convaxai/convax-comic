export const CONVAX_SETTINGS_CSS = String.raw`
.cvxSettingsTrigger {
  width: 100%;
  color: var(--cvx-beui-muted-foreground);
}

.cvxSettingsTrigger.cvxBeuiButton[data-size="icon"][data-wide="true"] {
  width: 100%;
  justify-content: flex-start;
  height: 40px;
  padding-inline: 10px;
  border-radius: var(--cvx-beui-radius-md);
}

.cvxSettingsTrigger.cvxBeuiButton[data-size="icon"][data-wide="false"] {
  width: 36px;
  height: 36px;
  margin-inline: auto;
  border-radius: var(--cvx-beui-radius-md);
}

.cvxSettingsTrigger .cvxBeuiButtonContent {
  width: 100%;
  justify-content: flex-start;
}

.cvxSettingsTrigger[data-wide="false"] .cvxBeuiButtonContent {
  justify-content: center;
}

.cvxSettingsTriggerContent {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.cvxSettingsTriggerLabel {
  overflow: hidden;
  color: var(--cvx-beui-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvxSettingsOverlay {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
}

.cvxSettingsBackdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: color-mix(in oklab, var(--cvx-beui-foreground) 24%, transparent);
  backdrop-filter: blur(8px);
}

.cvxSettingsPanel {
  position: relative;
  width: min(900px, calc(100vw - 40px));
  height: min(720px, calc(100vh - 40px));
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--cvx-beui-border) 82%, transparent);
  border-radius: 22px;
  color: var(--cvx-beui-foreground);
  background: var(--cvx-beui-card);
  box-shadow: var(--cvx-beui-shadow-md);
}

.cvxSettingsTabs {
  display: grid;
  height: 100%;
  grid-template-columns: 216px minmax(0, 1fr);
}

.cvxSettingsNav {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 18px;
  padding: 24px 14px;
  border-right: 1px solid var(--cvx-beui-border);
  background: var(--cvx-beui-secondary);
}

.cvxSettingsNavTitle {
  min-width: 0;
  padding: 0 10px;
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvxSettingsNav .cvxBeuiTabsList {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.cvxSettingsNav .cvxBeuiTabsTriggerShell {
  width: 100%;
}

.cvxSettingsNav .cvxBeuiTabsIndicator {
  border-radius: var(--cvx-beui-radius-md);
  background: var(--cvx-beui-accent-strong);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--cvx-beui-primary) 11%, transparent);
}

.cvxSettingsNav .cvxBeuiTabsTrigger {
  width: 100%;
  min-height: 40px;
  justify-content: flex-start;
  gap: 9px;
  padding-inline: 11px;
  border-radius: var(--cvx-beui-radius-md);
  color: var(--cvx-beui-muted-foreground);
  font-weight: 550;
}

.cvxSettingsNav .cvxBeuiTabsTrigger[aria-selected="true"] {
  color: var(--cvx-beui-foreground);
}

.cvxSettingsNavIcon {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  place-items: center;
  color: var(--cvx-beui-primary);
}

.cvxSettingsNavLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvxSettingsContent {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--cvx-beui-card);
}

.cvxSettingsHeader {
  display: flex;
  min-height: 72px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 16px 28px;
  border-bottom: 1px solid var(--cvx-beui-border);
}

.cvxSettingsSectionTitle {
  min-width: 0;
  overflow: hidden;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvxSettingsHeaderActions {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.cvxSettingsHeaderActions [data-slot="settings.action"] {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.cvxSettingsClose {
  flex: 0 0 auto;
}

.cvxSettingsViewport {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 8px 28px 32px;
  --dsh-scrollbar-thumb: color-mix(in oklab, var(--cvx-beui-muted-foreground) 38%, transparent);
}

.cvxSettingsTabPanel {
  min-width: 0;
}

.cvxSettingsGeneral {
  display: flex;
  width: 100%;
  flex-direction: column;
}

.cvxSettingsEmpty {
  display: grid;
  min-height: 220px;
  place-items: center;
  color: var(--cvx-beui-muted-foreground);
  font-size: 13px;
  text-align: center;
}

.cvxSettingsDocumentAction {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.cvxSettingsDocumentError {
  max-width: 180px;
  overflow: hidden;
  color: var(--cvx-beui-danger);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cvxSettingsSrOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 680px) {
  .cvxSettingsOverlay { padding: 12px; }
  .cvxSettingsPanel {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
    border-radius: 18px;
  }
  .cvxSettingsTabs {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .cvxSettingsNav {
    gap: 12px;
    padding: 16px;
    border-right: 0;
    border-bottom: 1px solid var(--cvx-beui-border);
  }
  .cvxSettingsNavTitle { padding-inline: 4px; }
  .cvxSettingsNav .cvxBeuiTabsList {
    flex-direction: row;
    overflow-x: auto;
  }
  .cvxSettingsNav .cvxBeuiTabsTriggerShell { width: auto; flex: 0 0 auto; }
  .cvxSettingsNav .cvxBeuiTabsTrigger { width: auto; }
  .cvxSettingsHeader { min-height: 64px; padding: 12px 14px 12px 20px; }
  .cvxSettingsViewport { padding: 6px 20px 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .cvxSettingsBackdrop { backdrop-filter: none; }
}
`
