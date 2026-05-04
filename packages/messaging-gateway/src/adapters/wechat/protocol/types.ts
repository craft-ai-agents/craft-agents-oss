/**
 * WeChat (Weixin) protocol types.
 *
 * Mirrors the proto schema used by Tencent's iLink bot endpoint
 * (`ilinkai.weixin.qq.com/ilink/bot/*`): GetUpdatesReq/Resp, WeixinMessage,
 * SendMessageReq, etc. The API uses JSON over HTTP — `bytes` proto fields are
 * encoded as base64 strings.
 *
 * ---------------------------------------------------------------------------
 * This file is ported from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. See repository NOTICE for attribution.
 * ---------------------------------------------------------------------------
 */

/** Common request metadata attached to every CGI request. */
export interface BaseInfo {
  channel_version?: string
}

/** proto: UploadMediaType */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const

export interface GetUploadUrlReq {
  filekey?: string
  /** proto field 2: media_type, see UploadMediaType */
  media_type?: number
  to_user_id?: string
  /** Plaintext size of the original file. */
  rawsize?: number
  /** Plaintext MD5 of the original file. */
  rawfilemd5?: string
  /** Ciphertext size of the original file (after AES-128-ECB encryption). */
  filesize?: number
  /** Plaintext size of the thumbnail (required for IMAGE/VIDEO). */
  thumb_rawsize?: number
  /** Plaintext MD5 of the thumbnail (required for IMAGE/VIDEO). */
  thumb_rawfilemd5?: string
  /** Ciphertext size of the thumbnail (required for IMAGE/VIDEO). */
  thumb_filesize?: number
  /** When true, do not request a thumbnail upload URL. Default: false. */
  no_need_thumb?: boolean
  /** AES-128 encryption key (raw bytes as hex or base64 per server contract). */
  aeskey?: string
}

export interface GetUploadUrlResp {
  /** Encrypted parameters for the original-file upload. */
  upload_param?: string
  /** Encrypted parameters for the thumbnail upload (empty when no thumb). */
  thumb_upload_param?: string
  /** Full upload URL returned by the server (no client-side concatenation needed). */
  upload_full_url?: string
}

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const

export interface TextItem {
  text?: string
}

/** CDN media reference; aes_key is base64-encoded bytes in JSON. */
export interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
  /** Encryption type: 0 = encrypt fileid only, 1 = bundle thumb/mid info. */
  encrypt_type?: number
  /** Full download URL returned by the server (no client-side concatenation). */
  full_url?: string
}

export interface ImageItem {
  /** Original-image CDN reference. */
  media?: CDNMedia
  /** Thumbnail CDN reference. */
  thumb_media?: CDNMedia
  /** Raw AES-128 key as hex string (16 bytes); preferred over media.aes_key for inbound decryption. */
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
  hd_size?: number
}

export interface VoiceItem {
  media?: CDNMedia
  /** Voice encoding: 1=pcm, 2=adpcm, 3=feature, 4=speex, 5=amr, 6=silk, 7=mp3, 8=ogg-speex. */
  encode_type?: number
  bits_per_sample?: number
  /** Sample rate in Hz. */
  sample_rate?: number
  /** Voice duration in milliseconds. */
  playtime?: number
  /** Server-side speech-to-text result, when available. */
  text?: string
}

export interface FileItem {
  media?: CDNMedia
  file_name?: string
  md5?: string
  len?: string
}

export interface VideoItem {
  media?: CDNMedia
  video_size?: number
  play_length?: number
  video_md5?: string
  thumb_media?: CDNMedia
  thumb_size?: number
  thumb_height?: number
  thumb_width?: number
}

export interface RefMessage {
  message_item?: MessageItem
  /** Summary text for the referenced message. */
  title?: string
}

export interface MessageItem {
  type?: number
  create_time_ms?: number
  update_time_ms?: number
  is_completed?: boolean
  msg_id?: string
  ref_msg?: RefMessage
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
}

/**
 * Unified message envelope (proto: WeixinMessage). Replaces the older split
 * Message + MessageContent + FullMessage shapes.
 */
export interface WeixinMessage {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  create_time_ms?: number
  update_time_ms?: number
  delete_time_ms?: number
  session_id?: string
  group_id?: string
  message_type?: number
  message_state?: number
  item_list?: MessageItem[]
  /** Conversation context token; must be echoed verbatim on every reply. */
  context_token?: string
}

/** GetUpdates request: bytes fields are base64 strings in JSON. */
export interface GetUpdatesReq {
  /** @deprecated compat only, will be removed */
  sync_buf?: string
  /**
   * Full context buf cached locally; send `""` for the first request and after
   * a server-driven reset.
   */
  get_updates_buf?: string
}

/** GetUpdates response: bytes fields are base64 strings in JSON. */
export interface GetUpdatesResp {
  ret?: number
  /** Server error code (e.g. -14 = session timeout). Present when request fails. */
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  /** @deprecated compat only */
  sync_buf?: string
  /** Full context buf to cache locally and send on the next request. */
  get_updates_buf?: string
  /** Server-suggested timeout (ms) for the next getUpdates long-poll. */
  longpolling_timeout_ms?: number
}

/** SendMessage request: wraps a single WeixinMessage. */
export interface SendMessageReq {
  msg?: WeixinMessage
}

export interface SendMessageResp {
  // empty
}

/** Typing status: 1 = typing (default), 2 = cancel typing. */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const

/** SendTyping request: send a typing indicator to a user. */
export interface SendTypingReq {
  ilink_user_id?: string
  typing_ticket?: string
  /** 1 = typing (default), 2 = cancel typing. */
  status?: number
}

export interface SendTypingResp {
  ret?: number
  errmsg?: string
}

/** GetConfig response: bot config including the typing_ticket. */
export interface GetConfigResp {
  ret?: number
  errmsg?: string
  /** Base64-encoded typing ticket for sendTyping. */
  typing_ticket?: string
}
