# Social Platform Playbooks

Last verified: 2026-05-26

Use this as tactical guidance, not immutable law. Refresh before high-stakes campaigns because platform specs and ranking behavior change.

## Sources Checked

- TikTok Help Center, video specs: https://support.tiktok.com/en/uploading-and-editing/uploading-videos/about-video-specs
- TikTok Help Center, camera/tools: https://support.tiktok.com/en/using-tiktok/creating-videos/camera-tools
- Instagram Help Center, Reels size/aspect ratios: https://www.facebook.com/help/instagram/1038071743007909?locale=en_GB
- YouTube Help, Shorts upload: https://support.google.com/youtube/answer/12779649?hl=en-uk
- YouTube Help, three-minute Shorts: https://support.google.com/youtube/answer/15424877?hl=en
- X API media upload best practices: https://docs.x.com/x-api/media/quickstart/best-practices

## TikTok

Default use: short vertical video.

Preflight:
- Prefer 9:16 vertical.
- Confirm video has motion or a visual hook immediately.
- Caption should front-load the hook; do not bury the point after hashtags.
- Use a small set of relevant hashtags. Avoid hashtag stuffing.
- Confirm music/audio rights if the asset was not created by the user.

Posting flow:
1. Navigate to TikTok upload/create.
2. Upload video.
3. Add caption.
4. Check cover, privacy, comments, duet/stitch, and commercial disclosure settings.
5. Ask approval at final submit if not already approved.

## Instagram

Default use:
- Reels for vertical video/discovery.
- Carousel/feed for visual proof, screenshots, before/after, or static assets.

Preflight:
- Reels: prefer 9:16 vertical and center-safe text.
- Feed images: prefer 1:1 or 4:5 when the user wants profile/grid quality.
- Confirm whether to share Reel to feed.
- Check product/brand/music rights before publishing.

Posting flow:
1. Navigate to create post/Reel.
2. Upload asset.
3. Pick format and crop.
4. Add caption, location, collaborator/product tags only if requested.
5. Check cover frame and share-to-feed setting.
6. Ask approval at final share if not already approved.

## X

Default use: concise text with optional media.

Technical guardrails from X media docs:
- A post can attach up to four photos, one animated GIF, or one video.
- Image types include JPG, PNG, GIF, and WEBP; image upload size is limited in the API docs.
- Video should use common H.264/AAC settings; X recommends 1280x720, 720x1280, or 720x720.

Posting heuristics:
- One point per post.
- Put the payoff in the first sentence.
- For replies, quote the specific point being answered.
- Avoid links in the main post when reach matters more than clicks.

Posting flow:
1. Navigate to compose or target post for reply.
2. Paste text rather than typing long copy manually.
3. Attach media if requested.
4. Check account/profile, audience, and reply target.
5. Ask approval at final Post/Reply/Send.

## YouTube

Default use:
- Shorts for square or vertical video up to 3 minutes.
- Long-form for 16:9 videos or depth/tutorial content.

Official Shorts guardrails:
- YouTube treats square or vertical videos up to 3 minutes as Shorts.
- Shorts over 1 minute with an active Content ID claim can be blocked globally.
- Uploads can be completed through YouTube Studio.

Posting flow:
1. Navigate to YouTube Studio upload.
2. Upload media.
3. Add title, description, thumbnail/cover if available, playlist only if requested.
4. Complete audience, paid promotion, checks, visibility, and schedule settings.
5. Ask approval before final publish/schedule.

## Cross-Platform Campaign Loop

For "post this everywhere":

1. Normalize the campaign payload.
2. Build a per-platform matrix: platform, profile, copy variant, media file, visibility, target, final action.
3. Dry-run every platform command first.
4. Ask for one batch approval if all payloads are visible and exact.
5. Execute one platform at a time through `browser_tool`.
6. After each platform, capture observed result before moving on.
7. Return one combined receipt.

## Setup Guidance For Users

When the user is new to the system, guide them through this sequence:

1. Create a Workspace Context doc with social defaults routed to `@social-publisher`.
2. Add one non-secret profile record per account:

```yaml
- platform: instagram
  profile: brand
  handle: "@brand"
  channel_url: "https://instagram.com/brand"
  default_visibility: public
  notes: "Use for launch and product posts."
```

3. For each platform/profile, run the CLI profile setup/login flow.
4. Have the user complete login in the browser once.
5. Run live doctor to confirm session readiness.
6. For future campaigns, use the named profile. Do not ask for passwords unless the local session expires and the user must re-authenticate.

Account switch rule:
- Never assume the active browser account is correct.
- Before final submit, check the visible account name/avatar/handle when the platform UI exposes it.
- If the visible account does not match the requested profile, stop and ask the user to choose or re-login.
