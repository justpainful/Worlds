/** Claude chat: split by concern under ./chat; this module keeps the public API. */
export { TOOL_LABEL, isAuthError, AuthHelp } from "./chat/tools";
export { readLastChat, chatsChanged, useChat } from "./chat/useChat";
export { MessageList, ChatEmpty, ModelButton } from "./chat/messages";
export { Composer } from "./chat/Composer";
export { ChatList } from "./chat/ChatList";
