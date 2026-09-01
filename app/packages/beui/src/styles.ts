export const BEUI_THEME_CSS = String.raw`
body {
  --cvx-beui-background: var(--dsw-alias-bg-base, #ffffff);
  --cvx-beui-foreground: var(--dsw-alias-label-primary, #18181b);
  --cvx-beui-neutral-surface: color-mix(in oklab, var(--cvx-beui-foreground) 3%, var(--cvx-beui-background));
  --cvx-beui-card: var(--cvx-beui-neutral-surface);
  --cvx-beui-popover: var(--cvx-beui-neutral-surface);
  --cvx-beui-primary: var(--dsw-alias-brand-primary, #18181b);
  --cvx-beui-primary-foreground: var(--dsw-alias-label-primary-foreground, #ffffff);
  --cvx-beui-secondary: var(--cvx-beui-neutral-surface);
  --cvx-beui-muted: var(--cvx-beui-neutral-surface);
  --cvx-beui-muted-foreground: var(--dsw-alias-label-secondary, #71717a);
  --cvx-beui-accent: var(--cvx-beui-neutral-surface);
  --cvx-beui-accent-strong: color-mix(in oklab, var(--cvx-beui-foreground) 7%, var(--cvx-beui-background));
  --cvx-beui-border: var(--dsw-alias-border-l1, #e4e4e7);
  --cvx-beui-border-strong: var(--dsw-alias-border-l2, #d4d4d8);
  --cvx-beui-danger: var(--dsw-alias-state-error-primary, #dc2626);
  --cvx-beui-success: var(--dsw-alias-state-success-primary, #16a34a);
  --cvx-beui-warning: var(--dsw-alias-state-warn-primary, #d97706);
  --cvx-beui-ring: color-mix(in oklab, var(--cvx-beui-foreground) 12%, transparent);
  --cvx-beui-shadow-xs: 0 1px 2px rgb(24 24 27 / 5%);
  --cvx-beui-shadow-sm: 0 2px 8px rgb(24 24 27 / 7%), 0 1px 2px rgb(24 24 27 / 5%);
  --cvx-beui-shadow-md: 0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%);
  --cvx-beui-radius-sm: 7px;
  --cvx-beui-radius-md: 10px;
  --cvx-beui-radius-lg: 14px;
  --cvx-beui-radius-pill: 999px;
  --cvx-beui-ease-out: cubic-bezier(.16, 1, .3, 1);
  --cvx-beui-ease-in-out: cubic-bezier(.77, 0, .175, 1);
  --cvx-beui-fast: 100ms;
  --cvx-beui-normal: 180ms;
  --cvx-beui-slow: 280ms;
  font-synthesis: none;
  text-rendering: geometricPrecision;
}

body[data-ds-dark-theme] {
  --cvx-beui-primary: var(--dsw-alias-brand-primary, #f4f4f5);
  --cvx-beui-primary-foreground: var(--dsw-alias-label-primary-foreground, #18181b);
  --cvx-beui-muted-foreground: color-mix(in oklab, var(--dsw-alias-label-secondary, #a1a1aa) 64%, var(--cvx-beui-background));
  --cvx-beui-ring: color-mix(in oklab, var(--cvx-beui-foreground) 10%, transparent);
  --cvx-beui-shadow-xs: 0 1px 2px rgb(0 0 0 / 18%);
  --cvx-beui-shadow-sm: 0 3px 10px rgb(0 0 0 / 24%);
  --cvx-beui-shadow-md: 0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%);
}

body ::selection {
  color: var(--cvx-beui-foreground);
  background: color-mix(in oklab, var(--cvx-beui-primary) 24%, transparent);
}

body :where(button, input, textarea, select) {
  font-family: inherit;
}

@media (prefers-reduced-motion: reduce) {
  body {
    --cvx-beui-fast: 0ms;
    --cvx-beui-normal: 0ms;
    --cvx-beui-slow: 0ms;
  }
}
`

export const BEUI_COMPONENT_CSS = String.raw`
.cvxBeuiButton {
  position: relative;
  appearance: none;
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  border: 1px solid transparent;
  outline: none;
  color: var(--cvx-beui-primary-foreground);
  background: var(--cvx-beui-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  user-select: none;
  cursor: pointer;
  transition: color var(--cvx-beui-fast) ease, background-color var(--cvx-beui-fast) ease, border-color var(--cvx-beui-fast) ease, box-shadow var(--cvx-beui-fast) ease;
  -webkit-app-region: no-drag;
}

.cvxBeuiButton[data-size="sm"] { height: 30px; padding: 0 11px; border-radius: var(--cvx-beui-radius-pill); font-size: 12px; }
.cvxBeuiButton[data-size="md"] { height: 38px; padding: 0 17px; border-radius: var(--cvx-beui-radius-pill); }
.cvxBeuiButton[data-size="lg"] { height: 44px; padding: 0 21px; border-radius: var(--cvx-beui-radius-pill); font-size: 14px; }
.cvxBeuiButton[data-size="icon"] { width: 32px; height: 32px; padding: 0; border-radius: var(--cvx-beui-radius-md); }
.cvxBeuiButton[data-variant="secondary"] { border-color: var(--cvx-beui-border); color: var(--cvx-beui-foreground); background: var(--cvx-beui-card); box-shadow: var(--cvx-beui-shadow-xs); }
.cvxBeuiButton[data-variant="ghost"] { color: var(--cvx-beui-muted-foreground); background: transparent; }
.cvxBeuiButton[data-variant="outline"] { border-color: var(--cvx-beui-border); color: var(--cvx-beui-foreground); background: transparent; }
.cvxBeuiButton[data-variant="danger"] { color: #fff; background: var(--cvx-beui-danger); }
.cvxBeuiButton:hover:not(:disabled) { filter: brightness(.98); }
.cvxBeuiButton[data-variant="ghost"]:hover:not(:disabled),
.cvxBeuiButton[data-variant="outline"]:hover:not(:disabled) { color: var(--cvx-beui-foreground); background: var(--cvx-beui-muted); filter: none; }
.cvxBeuiButton:focus-visible { box-shadow: 0 0 0 3px var(--cvx-beui-ring); }
.cvxBeuiButton:disabled { opacity: .45; pointer-events: none; }
.cvxBeuiButtonContent { position: relative; z-index: 1; display: inline-flex; min-width: 0; align-items: center; justify-content: center; gap: inherit; }
.cvxBeuiRippleClip { position: absolute; z-index: 0; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; }
.cvxBeuiRipple { position: absolute; border-radius: 999px; color: currentColor; background: currentColor; pointer-events: none; }

.cvxBeuiSelect { position: relative; min-width: 0; }
.cvxBeuiSelectTrigger { position: relative; z-index: 10; appearance: none; display: flex; width: 100%; height: 38px; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border: 1px solid var(--cvx-beui-border); border-radius: 12px; outline: none; color: var(--cvx-beui-foreground); background: var(--cvx-beui-background); font: inherit; font-size: 14px; font-weight: 400; line-height: 20px; text-align: left; cursor: pointer; transition: color var(--cvx-beui-fast) ease, border-color var(--cvx-beui-fast) ease, box-shadow var(--cvx-beui-fast) ease; -webkit-app-region: no-drag; }
.cvxBeuiSelectTrigger:hover:not(:disabled) { border-color: var(--cvx-beui-border-strong); }
.cvxBeuiSelectTrigger:focus-visible { box-shadow: 0 0 0 2px var(--cvx-beui-ring); }
.cvxBeuiSelectTrigger:disabled { opacity: .5; pointer-events: none; }
.cvxBeuiSelectValue { min-width: 0; overflow: hidden; color: var(--cvx-beui-foreground); text-overflow: ellipsis; white-space: nowrap; }
.cvxBeuiSelectValue[data-placeholder="true"] { color: var(--cvx-beui-muted-foreground); }
.cvxBeuiSelectChevron { display: grid; width: 16px; height: 16px; flex: 0 0 16px; place-items: center; color: var(--cvx-beui-muted-foreground); }
.cvxBeuiSelectMenu { position: absolute; z-index: 20; right: 0; left: 0; box-sizing: border-box; border: 1px solid var(--cvx-beui-border); border-radius: 12px; background: var(--cvx-beui-background); box-shadow: var(--cvx-beui-shadow-md); }
.cvxBeuiSelectMenu[data-placement="bottom"] { top: 100%; }
.cvxBeuiSelectMenu[data-placement="top"] { bottom: 100%; }
.cvxBeuiSelectList { padding: 4px; }
.cvxBeuiSelectItem { display: block; }
.cvxBeuiSelectOption { appearance: none; display: flex; width: 100%; min-width: 0; height: 32px; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border: 0; border-radius: 8px; outline: none; color: var(--cvx-beui-muted-foreground); background: transparent; font: inherit; font-size: 14px; font-weight: 400; line-height: 20px; text-align: left; cursor: pointer; transition: color var(--cvx-beui-fast) ease, background-color var(--cvx-beui-fast) ease; }
.cvxBeuiSelectOption:hover, .cvxBeuiSelectOption[data-active="true"], .cvxBeuiSelectOption:focus-visible { color: var(--cvx-beui-foreground); background: var(--cvx-beui-muted); }
.cvxBeuiSelectOption[aria-selected="true"] { color: var(--cvx-beui-foreground); background: var(--cvx-beui-muted); }
.cvxBeuiSelectOption:disabled { opacity: .5; cursor: not-allowed; }
.cvxBeuiSelectOptionLabel { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cvxBeuiSelectCheck { width: 14px; height: 14px; flex: 0 0 14px; color: currentColor; }
.cvxBeuiSelectEmpty { padding: 12px 10px; color: var(--cvx-beui-muted-foreground); font-size: 13px; text-align: center; }

.cvxBeuiFileTree {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  color: var(--cvx-beui-foreground);
  font-size: 13px;
}

.cvxBeuiFileTreeRowShell { position: relative; min-width: 0; }
.cvxBeuiFileTreeItem {
  position: relative;
  appearance: none;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding-top: 0;
  padding-right: 8px;
  padding-bottom: 0;
  border: 0;
  border-radius: var(--cvx-beui-radius-md);
  outline: none;
  color: var(--cvx-beui-muted-foreground);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  isolation: isolate;
  transition: color var(--cvx-beui-fast) ease;
}
.cvxBeuiFileTreeItem:hover, .cvxBeuiFileTreeItem.is-selected { color: var(--cvx-beui-foreground); }
.cvxBeuiFileTreeItem:focus-visible { box-shadow: inset 0 0 0 2px var(--cvx-beui-ring); }
.cvxBeuiFileTreeItem[draggable="true"] { cursor: grab; }
.cvxBeuiFileTreeItem[draggable="true"]:active { cursor: grabbing; }
.cvxBeuiFileTreeItem[aria-disabled="true"] { cursor: not-allowed; }
.cvxBeuiFileTreeHover,
.cvxBeuiFileTreeSelection { position: absolute; z-index: -2; inset: 0; border-radius: inherit; pointer-events: none; }
.cvxBeuiFileTreeHover { background: color-mix(in oklab, var(--cvx-beui-foreground) 5%, transparent); }
.cvxBeuiFileTreeSelection { background: var(--cvx-beui-accent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--cvx-beui-primary) 8%, transparent); }
.cvxBeuiFileTreeBranch { position: absolute; z-index: -1; top: -3px; bottom: -3px; width: 1px; transform-origin: top; background: linear-gradient(to bottom, transparent, var(--cvx-beui-border-strong) 12%, var(--cvx-beui-border-strong) 88%, transparent); pointer-events: none; }
.cvxBeuiFileTreeChevron { position: relative; z-index: 1; display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; color: var(--cvx-beui-muted-foreground); }
.cvxBeuiFileTreeChevron.is-empty { visibility: hidden; }
.cvxBeuiFileTreeIcon { position: relative; z-index: 1; display: grid; width: 17px; height: 17px; flex: 0 0 17px; place-items: center; color: var(--cvx-beui-muted-foreground); }
.cvxBeuiFileTreeIcon > svg, .cvxBeuiFileTreeIconSwap > svg { display: block; width: 16px; height: 16px; }
.cvxBeuiFileTreeIconSwap { display: grid; place-items: center; }
.cvxBeuiFileTreeLabel { position: relative; z-index: 1; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cvxBeuiSwitchRoot { display: inline-flex; align-items: center; gap: 10px; }
.cvxBeuiSwitch { appearance: none; display: flex; width: 46px; height: 26px; flex: 0 0 46px; align-items: center; justify-content: flex-start; padding: 3px; border: 0; border-radius: var(--cvx-beui-radius-pill); outline: none; color: var(--cvx-beui-foreground); background: color-mix(in oklab, var(--cvx-beui-muted-foreground) 54%, transparent); cursor: pointer; transition: background-color var(--cvx-beui-normal) var(--cvx-beui-ease-out), box-shadow var(--cvx-beui-fast) ease; }
.cvxBeuiSwitch[data-state="checked"] { justify-content: flex-end; background: var(--cvx-beui-primary); }
.cvxBeuiSwitch:focus-visible { box-shadow: 0 0 0 3px var(--cvx-beui-ring); }
.cvxBeuiSwitch:disabled { opacity: .45; cursor: not-allowed; }
.cvxBeuiSwitchThumb { display: block; width: 20px; height: 20px; border-radius: 50%; background: var(--cvx-beui-card); box-shadow: var(--cvx-beui-shadow-sm); pointer-events: none; }
.cvxBeuiSwitchLabel { color: var(--cvx-beui-foreground); font-size: 13px; cursor: pointer; }

.cvxBeuiTabs { min-width: 0; }
.cvxBeuiTabsList { display: inline-flex; max-width: 100%; align-items: center; gap: 3px; padding: 3px; border-radius: var(--cvx-beui-radius-pill); background: var(--cvx-beui-muted); }
.cvxBeuiTabsList[data-variant="segment"] { gap: 0; border-radius: var(--cvx-beui-radius-md); }
.cvxBeuiTabsList[data-variant="underline"] { gap: 4px; padding: 0; border-bottom: 1px solid var(--cvx-beui-border); border-radius: 0; background: transparent; }
.cvxBeuiTabsTriggerShell { position: relative; min-width: 0; }
.cvxBeuiTabsIndicator { position: absolute; z-index: 0; inset: 0; border-radius: var(--cvx-beui-radius-pill); background: var(--cvx-beui-primary); box-shadow: var(--cvx-beui-shadow-xs); }
.cvxBeuiTabsIndicator[data-variant="segment"] { border-radius: var(--cvx-beui-radius-sm); }
.cvxBeuiTabsIndicator[data-variant="underline"] { top: auto; bottom: -1px; height: 2px; border-radius: 2px; box-shadow: none; }
.cvxBeuiTabsTrigger { position: relative; z-index: 1; appearance: none; display: inline-flex; min-height: 34px; align-items: center; justify-content: center; padding: 0 13px; border: 0; border-radius: var(--cvx-beui-radius-pill); outline: none; color: var(--cvx-beui-muted-foreground); background: transparent; font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: color var(--cvx-beui-fast) ease; }
.cvxBeuiTabsTrigger[aria-selected="true"] { color: var(--cvx-beui-primary-foreground); }
.cvxBeuiTabsList[data-variant="underline"] .cvxBeuiTabsTrigger { border-radius: 0; }
.cvxBeuiTabsList[data-variant="underline"] .cvxBeuiTabsTrigger[aria-selected="true"] { color: var(--cvx-beui-foreground); }
.cvxBeuiTabsTrigger:focus-visible { box-shadow: inset 0 0 0 2px var(--cvx-beui-ring); }

.cvxBeuiInputRoot { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.cvxBeuiInputLabel { padding: 0 4px; color: var(--cvx-beui-foreground); font-size: 13px; font-weight: 600; }
.cvxBeuiInputField { position: relative; height: 40px; overflow: hidden; border: 1px solid var(--cvx-beui-border); border-radius: var(--cvx-beui-radius-pill); background: var(--cvx-beui-card); transition: border-color var(--cvx-beui-normal) ease, box-shadow var(--cvx-beui-normal) ease; }
.cvxBeuiInputField[data-state="focused"] { border-color: color-mix(in oklab, var(--cvx-beui-primary) 45%, var(--cvx-beui-border)); box-shadow: 0 0 0 3px var(--cvx-beui-ring); }
.cvxBeuiInputField[data-state="error"] { border-color: var(--cvx-beui-danger); box-shadow: 0 0 0 3px color-mix(in oklab, var(--cvx-beui-danger) 22%, transparent); }
.cvxBeuiInputField[data-disabled="true"] { opacity: .5; }
.cvxBeuiInput { appearance: none; width: 100%; height: 100%; box-sizing: border-box; padding: 0 14px; border: 0; outline: none; color: var(--cvx-beui-foreground); background: transparent; font: inherit; font-size: 14px; }
.cvxBeuiInput[data-left-icon="true"] { padding-left: 39px; }
.cvxBeuiInput[data-right-icon="true"] { padding-right: 39px; }
.cvxBeuiInput::placeholder { color: color-mix(in oklab, var(--cvx-beui-muted-foreground) 68%, transparent); }
.cvxBeuiInputLeft, .cvxBeuiInputRight, .cvxBeuiInputSuccess { position: absolute; z-index: 1; top: 50%; width: 18px; height: 18px; color: var(--cvx-beui-muted-foreground); transform: translateY(-50%); }
.cvxBeuiInputLeft { left: 13px; }
.cvxBeuiInputRight, .cvxBeuiInputSuccess { right: 13px; }
.cvxBeuiInputSuccess { color: var(--cvx-beui-success); }
.cvxBeuiInputMessage { min-height: 0; }
.cvxBeuiInputMessage.is-reserved { min-height: 16px; }
.cvxBeuiInputError { margin: 0; padding: 0 4px; color: var(--cvx-beui-danger); font-size: 12px; line-height: 16px; }

@media (forced-colors: active) {
  .cvxBeuiButton, .cvxBeuiFileTreeItem { forced-color-adjust: auto; }
  .cvxBeuiFileTreeSelection { border: 1px solid Highlight; }
}
`
