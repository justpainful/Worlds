import { useState } from "react";
import { Icon, type IconName } from "../../ui/Icon";

// ---------------------------------------------------------------------------
// Tool labels
// ---------------------------------------------------------------------------

export const TOOL_LABEL: Record<string, [string, IconName]> = {
  pages_search: ["Searching pages", "search"],
  pages_list: ["Looking through your pages", "pages"],
  pages_read: ["Reading a page", "page"],
  pages_create: ["Creating a page", "add"],
  pages_rename: ["Renaming a page", "edit"],
  pages_move: ["Moving a page", "move"],
  pages_archive: ["Archiving a page", "archive"],
  pages_set_icon: ["Setting a page icon", "emoji"],
  pages_pin: ["Pinning a page", "pin"],
  pages_favorite: ["Marking a favourite", "favorite"],
  pages_duplicate: ["Duplicating a page", "duplicate"],
  pages_delete: ["Moving a page to Trash", "delete"],
  pages_restore: ["Restoring from Trash", "restore"],
  pages_replace_content: ["Rewriting a page", "edit"],
  trash_list: ["Looking in Trash", "delete"],
  blocks_read: ["Reading blocks", "page"],
  blocks_insert: ["Adding content", "add"],
  blocks_update: ["Editing a block", "edit"],
  blocks_move: ["Reordering blocks", "move"],
  blocks_delete: ["Removing a block", "delete"],
  references_search: ["Checking references", "mention"],
  references_resolve: ["Finding a page to mention", "mention"],
  attachments_add: ["Attaching a file", "attachment"],
  attachments_read_metadata: ["Checking attachments", "attachment"],
  templates_list: ["Looking at templates", "template"],
  templates_instantiate: ["Creating from a template", "template"],
  templates_create_from_page: ["Saving a template", "template"],
  automations_list: ["Checking automations", "automation"],
  automations_create: ["Creating an automation", "schedule"],
  automations_update: ["Updating an automation", "schedule"],
  automations_delete: ["Deleting an automation", "delete"],
  automations_run: ["Requesting an automation run", "automation"],
  discord_inspect: ["Checking Discord destinations", "discord"],
  discord_preview: ["Rendering a Discord preview", "discord"],
  discord_send: ["Queuing a Discord message for your approval", "discord"],
  discord_edit: ["Queuing a Discord edit for your approval", "discord"],
  profile_read: ["Reading your profile", "profile"],
  profile_update: ["Updating your profile", "profile"],
  history_read: ["Reading history", "history"],
  instructions_read: ["Reading assistant instructions", "instructions"],
  instructions_update: ["Updating assistant instructions", "instructions"],
  chats_search: ["Looking through earlier chats", "assistant"],
  chats_read: ["Reading an earlier chat", "assistant"],
};

export const isAuthError = (t?: string | null) => !!t && /failed to authenticate|oauth|not logged in|please run \/login|invalid api key/i.test(t);

/** Claude Code's own sign-in expired: Worlds cannot (and should not) log in for the user. */
export function AuthHelp() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="warn warn-warn ai-auth">
      <Icon name="lock" size={14} />
      <div>
        <div><strong>Claude Code needs you to sign in again.</strong></div>
        <div>Worlds runs your local Claude Code, and its login has expired. Open a terminal, run the command below, finish the sign-in in your browser, then ask again.</div>
        <div className="ai-auth-cmd">
          <code dir="ltr">claude auth login</code>
          <button className="chip-btn" onClick={() => { navigator.clipboard.writeText("claude auth login"); setCopied(true); }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
