import Foundation

/// Mirrors the MVP subset of `RPC_CHANNELS` in `packages/shared/src/protocol/channels.ts`.
/// These are wire-format string constants — the stable API contract with the server.
/// Add new nested enums here as later phases need more channels; do not rename
/// existing raw values without a matching server-side change.
public enum RPCChannels {
    public enum Server {
        public static let getWorkspaces = "server:getWorkspaces"
        public static let createWorkspace = "server:createWorkspace"
        public static let getStatus = "server:getStatus"
        public static let getHealth = "server:getHealth"
    }

    public enum Sessions {
        public static let get = "sessions:get"
        public static let getMessages = "sessions:getMessages"
        public static let sendMessage = "sessions:sendMessage"
        public static let create = "sessions:create"
        public static let delete = "sessions:delete"
        public static let cancel = "sessions:cancel"
        public static let killShell = "sessions:killShell"
        public static let command = "sessions:command"
        public static let respondToPermission = "sessions:respondToPermission"
        public static let respondToCredential = "sessions:respondToCredential"
        public static let getPermissionModeState = "sessions:getPermissionModeState"
        public static let getUnreadSummary = "sessions:getUnreadSummary"
        public static let markAllRead = "sessions:markAllRead"
        public static let getFiles = "sessions:getFiles"
        public static let getNotes = "sessions:getNotes"
        public static let setNotes = "sessions:setNotes"
        public static let searchContent = "sessions:searchContent"
        /// Note the singular "session" prefix — these channel names do not
        /// follow the "sessions:" pattern used by the rest of this namespace.
        public static let event = "session:event"
        public static let getModel = "session:getModel"
        public static let setModel = "session:setModel"
    }

    public enum Statuses {
        public static let list = "statuses:list"
    }

    public enum Labels {
        public static let list = "labels:list"
        public static let create = "labels:create"
        public static let delete = "labels:delete"
    }

    public enum Sources {
        public static let get = "sources:get"
    }

    public enum Skills {
        public static let get = "skills:get"
    }

    public enum LlmConnections {
        public static let list = "LLM_Connection:list"
    }
}
