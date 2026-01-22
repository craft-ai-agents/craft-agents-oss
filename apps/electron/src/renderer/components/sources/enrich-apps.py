#!/usr/bin/env python3
"""
Enrich app data using Parallel AI Task API.
Processes all apps in parallel batches and saves results to JSON.
"""

import json
import os
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# Parallel AI API configuration
API_KEY = os.environ.get("PARALLEL_API_KEY")
BASE_URL = "https://api.parallel.ai"
HEADERS = {
    "x-api-key": API_KEY,
    "Content-Type": "application/json"
}

# All apps to enrich (232 unique apps)
APPS = [
    "1Password", "Ably", "AfterShip", "Airtable", "Algolia", "Alpaca", "Amazon S3",
    "Amazon Selling Partner", "Amplitude", "Anthropic", "Any.do", "Anyscale", "Anytype",
    "Apollo", "Apple Notes", "Asana", "AssemblyAI", "Attio", "Auth0", "AWS Bedrock",
    "Azure OpenAI", "Backblaze B2", "Basecamp", "Baseten", "Bear", "BigCommerce",
    "Bluesky", "Box", "Brex", "Buffer", "Buildkite", "Bunny CDN", "Cal.com", "Calendly",
    "Calm", "Canva", "Capacities", "Centered", "Chargebee", "Chroma", "CircleCI",
    "Clearbit", "Clerk", "ClickUp", "Clockify", "Close", "Cloudflare R2",
    "Cloudflare Stream", "Cloudflare Workers", "Cloudinary", "CockroachDB", "Coda",
    "Cohere", "Coinbase", "ConvertKit", "Convex", "Copper", "Courier", "Craft",
    "CrowdStrike", "Datadog", "Day One", "Deepgram", "Deno Deploy", "Descope",
    "Descript", "DEVONthink", "Discord", "Doppler", "Drafts", "Drata", "Dropbox",
    "EasyPost", "ElevenLabs", "Etsy", "Evernote", "Exa", "Fantastical",
    "Fathom Analytics", "Fauna", "Figma", "Firebase", "Fireworks AI", "Fly.io", "Folk",
    "Forest", "Framer", "Freeform", "Freshsales", "FullStory", "Giphy", "GitHub",
    "GitHub Actions", "GitLab", "Gmail", "GoodNotes", "Google AI", "Google Analytics",
    "Google Drive", "Google Keep", "Grafana Cloud", "Grid Diary", "Groq", "Gumroad",
    "Habitica", "Harvest", "HashiCorp Vault", "Headspace", "Heap", "Height", "Heptabase",
    "HEY", "Hootsuite", "Hotjar", "HubSpot", "Hugging Face", "Hunter", "iA Writer",
    "imgix", "Infisical", "Inngest", "Instapaper", "Intercom", "Jira", "Journey", "June",
    "Knock", "LangSmith", "LaunchDarkly", "Lemon Squeezy", "Leonardo AI", "Linear",
    "LinkedIn", "LogRocket", "Logseq", "Loom", "Mailchimp", "Mailgun", "Mailspring",
    "Make", "Mastodon", "Matter", "Mem", "Mercury", "MessageBird", "Meta Graph",
    "Microsoft OneNote", "Milvus", "Miro", "Mistral AI", "Mixpanel", "Modal",
    "Monday.com", "MongoDB Atlas", "Moov", "Motion", "Mux", "n8n", "Neon", "Netlify",
    "New Relic", "Notability", "Noteshelf", "Notion", "Novu", "Obsidian", "Okta",
    "OmniFocus", "OneDrive", "Opal", "OpenAI", "Outlook", "Paddle", "Paperpile",
    "PayPal", "Perplexity", "Pexels", "Pinboard", "Pinecone", "Pinterest", "Pipedream",
    "Pipedrive", "Pirsch", "Plaid", "PlanetScale", "Plausible", "Playwright", "Pocket",
    "PostHog", "Postmark", "Printful", "Pusher", "Qdrant", "QStash", "QuickBooks",
    "Railway", "Raindrop.io", "Ramp", "Readwise", "Reclaim.ai", "Reddit", "Redis Cloud",
    "Reflect", "Remember The Milk", "Render", "Replicate", "RescueTime", "Resend",
    "Retool", "Roam Research", "Routine", "RudderStack", "Runway", "Salesforce",
    "Scrintal", "Scrivener", "Segment", "SendGrid", "Sentry", "SerpAPI", "Serper",
    "Shippo", "Shopify", "Shortcut", "Simple Analytics", "Simplenote", "SingleStore",
    "Slack", "Snyk", "Spark", "Split", "Spotify", "Square", "Stability AI",
    "Standard Notes", "Statsig", "Stoic", "Streaks", "Stream", "Stripe", "Stytch",
    "Sunsama", "Supabase", "Superhuman", "Tana", "Tavily", "Telegram", "Temporal",
    "Things 3", "TickTick", "Tigris", "TikTok", "Timing", "Todoist", "Together AI",
    "Toggl Track", "Trello", "Trigger.dev", "Turso", "Twilio", "Twitch", "Ulysses",
    "Unit", "Unsplash", "UpNote", "Upstash", "Vanta", "Vercel", "Vimeo", "Vonage",
    "Wasabi", "Weaviate", "Webflow", "Weights & Biases", "Wise", "WooCommerce",
    "WorkOS", "Xata", "Xero", "YouTube", "Zapier", "Zendesk", "Zoho CRM", "Zotero"
]

# Task spec for enrichment - simplified schema for better results
TASK_SPEC = {
    "description": "Find the official domain, API documentation URL, and a brief description of API capabilities for this app/service.",
    "output_schema": {
        "type": "json",
        "json_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "domain": {"type": "string", "description": "Official website domain only (e.g., linear.app)"},
                "api_docs_url": {"type": "string", "description": "Direct URL to API/developer documentation"},
                "capabilities": {"type": "string", "description": "Brief summary of what developers can do with the API"}
            },
            "required": ["name", "domain", "api_docs_url", "capabilities"]
        }
    }
}


def create_task(app_name: str) -> dict:
    """Create an enrichment task for a single app."""
    payload = {
        "processor": "base",
        "input": app_name,
        "task_spec": TASK_SPEC
    }

    response = requests.post(
        f"{BASE_URL}/v1/tasks/runs",
        headers=HEADERS,
        json=payload,
        timeout=30
    )
    response.raise_for_status()
    return response.json()


def get_task_result(run_id: str, max_wait: int = 120) -> dict:
    """Wait for task completion and return result."""
    start_time = time.time()

    while time.time() - start_time < max_wait:
        response = requests.get(
            f"{BASE_URL}/v1/tasks/runs/{run_id}",
            headers=HEADERS,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        if data["status"] == "completed":
            # Get full result
            result_response = requests.get(
                f"{BASE_URL}/v1/tasks/runs/{run_id}/result",
                headers=HEADERS,
                timeout=30
            )
            result_response.raise_for_status()
            return result_response.json()
        elif data["status"] == "failed":
            return {"error": "Task failed", "run_id": run_id}

        time.sleep(2)  # Poll every 2 seconds

    return {"error": "Timeout waiting for task", "run_id": run_id}


def enrich_app(app_name: str) -> dict:
    """Enrich a single app - create task and wait for result."""
    try:
        # Create task
        task = create_task(app_name)
        run_id = task["run_id"]
        print(f"  [{app_name}] Task created: {run_id}")

        # Wait for result
        result = get_task_result(run_id)

        if "error" in result:
            print(f"  [{app_name}] Error: {result['error']}")
            return {"name": app_name, "error": result["error"]}

        # Extract content from result
        content = result.get("output", {}).get("content", {})
        print(f"  [{app_name}] Done: {content.get('domain', 'N/A')}")
        return content

    except Exception as e:
        print(f"  [{app_name}] Exception: {str(e)}")
        return {"name": app_name, "error": str(e)}


def main():
    """Main function to enrich all apps."""
    if not API_KEY:
        print("Error: PARALLEL_API_KEY environment variable not set")
        return

    print(f"Starting enrichment for {len(APPS)} apps...")
    print("=" * 60)

    results = []
    errors = []

    # Process in parallel with ThreadPoolExecutor
    # Using 10 concurrent workers to respect rate limits
    with ThreadPoolExecutor(max_workers=10) as executor:
        # Submit all tasks
        future_to_app = {executor.submit(enrich_app, app): app for app in APPS}

        # Collect results as they complete
        for i, future in enumerate(as_completed(future_to_app), 1):
            app = future_to_app[future]
            try:
                result = future.result()
                if "error" in result:
                    errors.append(result)
                else:
                    results.append(result)
            except Exception as e:
                errors.append({"name": app, "error": str(e)})

            # Progress update
            if i % 20 == 0:
                print(f"\nProgress: {i}/{len(APPS)} ({len(results)} success, {len(errors)} errors)")

    print("\n" + "=" * 60)
    print(f"Completed: {len(results)} success, {len(errors)} errors")

    # Save results
    output = {
        "enriched_apps": results,
        "errors": errors,
        "stats": {
            "total": len(APPS),
            "success": len(results),
            "errors": len(errors)
        }
    }

    output_path = os.path.join(os.path.dirname(__file__), "enrichment-results.json")
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
