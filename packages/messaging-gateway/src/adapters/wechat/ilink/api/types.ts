// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
/**
 * Weixin protocol types (mirrors proto: GetUpdatesReq/Resp, WeixinMessage, SendMessageReq).
 * API uses JSON over HTTP; bytes fields are base64 strings in JSON.
 */

/** Common request metadata attached to every CGI request. */
export interface BaseInfo {
  channel_version?: string;
  /**
   * Self-declared identity of the upstream bot/app, analogous to HTTP
   * `User-Agent`. Filled from `channels.openclaw-weixin.botAgent` in
   * openclaw.json; defaults to `"OpenClaw"` when unset.
   *
   * Format: UA-style `Name/Version` tokens, optionally followed by
   * `(comment)`, multiple tokens space-separated. ASCII only, total
   * length <= 256 bytes after sanitization.
   *
   * For observability only (logging, monitoring aggregation); not used
   * for authentication or routing.
   */
  bot_agent?: string;
}

/** proto: UploadMediaType */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export interface GetUploadUrlReq {
  filekey?: string;
  /** proto field 2: media_type, see UploadMediaType */
  media_type?: number;
  to_user_id?: string;
  /** 原文件明文大小 */
  rawsize?: number;
  /** 原文件明文 MD5 */
  rawfilemd5?: string;
  /** 原文件密文大小（AES-128-ECB 加密后） */
  filesize?: number;
  /** 缩略图明文大小（IMAGE/VIDEO 时必填） */
  thumb_rawsize?: number;
  /** 缩略图明文 MD5（IMAGE/VIDEO 时必填） */
  thumb_rawfilemd5?: string;
  /** 缩略图密文大小（IMAGE/VIDEO 时必填） */
  thumb_filesize?: number;
  /** 不需要缩略图上传 URL，默认 false */
  no_need_thumb?: boolean;
  /** 加密 key */
  aeskey?: string;
}

export interface GetUploadUrlResp {
  /** 原图上传加密参数 */
  upload_param?: string;
  /** 缩略图上传加密参数，无缩略图时为空 */
  thumb_upload_param?: string;
  /** 完整上传 URL（服务端直接返回，无需客户端拼接） */
  upload_full_url?: string;
}

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text?: string;
}

/** CDN media reference; aes_key is base64-encoded bytes in JSON. */
export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  /** 加密类型: 0=只加密fileid, 1=打包缩略图/中图等信息 */
  encrypt_type?: number;
  /** 完整下载 URL（服务端直接返回，无需客户端拼接） */
  full_url?: string;
}

export interface ImageItem {
  /** 原图 CDN 引用 */
  media?: CDNMedia;
  /** 缩略图 CDN 引用 */
  thumb_media?: CDNMedia;
  /** Raw AES-128 key as hex string (16 bytes); preferred over media.aes_key for inbound decryption. */
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  /** 语音编码类型：1=pcm 2=adpcm 3=feature 4=speex 5=amr 6=silk 7=mp3 8=ogg-speex */
  encode_type?: number;
  bits_per_sample?: number;
  /** 采样率 (Hz) */
  sample_rate?: number;
  /** 语音长度 (毫秒) */
  playtime?: number;
  /** 语音转文字内容 */
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string; // 摘要
}

export interface ToolCallStartItem {
  tool_name?: string;
  tool_call_id?: string;
}

export interface ToolCallResultItem {
  tool_name?: string;
  tool_call_id?: string;
  status?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  tool_call_start_item?: ToolCallStartItem;
  tool_call_result_item?: ToolCallResultItem;
}

/** Unified message (proto: WeixinMessage). Replaces the old split Message + MessageContent + FullMessage. */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  run_id?: string;
}

/** GetUpdates request: bytes fields are base64 strings in JSON. */
export interface GetUpdatesReq {
  /** @deprecated compat only, will be removed */
  sync_buf?: string;
  /** Full context buf cached locally; send "" when none (first request or after reset). */
  get_updates_buf?: string;
}

/** GetUpdates response: bytes fields are base64 strings in JSON. */
export interface GetUpdatesResp {
  ret?: number;
  /** Error code returned by the server (e.g. -14 = session timeout). Present when request fails. */
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  /** @deprecated compat only */
  sync_buf?: string;
  /** Full context buf to cache locally and send on next request. */
  get_updates_buf?: string;
  /** Server-suggested timeout (ms) for the next getUpdates long-poll. */
  longpolling_timeout_ms?: number;
}

/** SendMessage request: wraps a single WeixinMessage. */
export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendMessageResp {
  ret?: number;
  /** Error code returned by the server (e.g. -14 = session timeout). Present when the reply is rejected. */
  errcode?: number;
  errmsg?: string;
}

/** Typing status: 1 = typing (default), 2 = cancel typing. */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

/** SendTyping request: send a typing indicator to a user. */
export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1=typing (default), 2=cancel typing */
  status?: number;
}

export interface SendTypingResp {
  ret?: number;
  errmsg?: string;
}

/** GetConfig response: bot config including typing_ticket. */
export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  /** Base64-encoded typing ticket for sendTyping. */
  typing_ticket?: string;
}

/** proto: NotifyStopReq — notify server when the channel client is stopping. */
export interface NotifyStopReq {
  base_info?: BaseInfo;
}

/** proto: NotifyStopResp */
export interface NotifyStopResp {
  ret?: number;
  errmsg?: string;
}

/** proto: NotifyStartReq — notify server when the channel client is starting. */
export interface NotifyStartReq {
  base_info?: BaseInfo;
}

/** proto: NotifyStartResp */
export interface NotifyStartResp {
  ret?: number;
  errmsg?: string;
}
