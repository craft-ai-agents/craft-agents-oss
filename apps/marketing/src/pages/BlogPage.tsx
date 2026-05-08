import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Markdown } from '@craft-agent/ui/markdown'

/**
 * Blog page — renders a single blog post directly.
 * Uses the shared Markdown component for content rendering.
 */

const postDate = 'January 20, 2026'

const postContent = `
## TL;DR

We've released **Craft Agents** as an open source product. It showcases our take on how to effectively work with agents (especially Claude Code). It works great for both engineers and knowledge workers. Most importantly, you can fork it, customize it, so it fits your needs perfectly. It's both a powerful tool, but also an experiment for the future of personal software. Take the base, and make it yours.

You can download it at [agents.craft.do](https://agents.craft.do) and view the source at [github.com/craft-ai-agents/craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss).

It has the full power of Claude Code, but packaged in a UX, and workflows which we found to be effective. It's also quickly becoming a daily driver for most of the things we do at Craft.

We have engineers using it internally as their main interface, but we're thrilled to see that our non-technical teams (Finance, Marketing, Customer Support and People) are really starting to grasp the power of AI as they can use a UI that is not CLI.

## How It Started

It's a product of two separate tracks merging into one.

In December, we wanted to understand the possibilities of an ultra powerful agent in Craft, and we built a CLI/TUI tool for this. As it got connected to Craft, we naturally wanted to use it for more and more, and we also deeply understood the possibilities of the Claude Agent SDK. At the same time I also became a power user of Claude Code. While I loved it, I've been struggling a lot with certain areas: reviewing plans, understanding deeper what changes (and why!) are being made, and multitasking. Also, I am quite picky of software I use when it comes to UI and UX, and the terminal isn't my happy place. I like UI, typography, the touchpad, and generally nicely designed software.

### What I Tried First

I've tried a few things first, like **Cursor** and their agentic interface. Its strong reliance on the VS Code editor meant I'm losing focus and having a hard time understanding what connects with what. I was jumping between code, the conversation and never really got grounded, focused.

After this I tried **Conductor**, which clicked lots of my boxes. It's a beautifully designed piece of software, but work-trees are really not my thing, and apparently those are at the heart of Conductor. Also, I still felt like I'm seeing a wall of text and actions between turns, so while it felt better, still didn't quite catch my flow.

As Conductor isn't open source, I couldn't just fork it and tweak it in a way that fits my needs. So I decided I'll do something simple for myself and see how that goes. As an added bonus, I'll try to do some development with web technologies. I never really did that before (apart from some basic marketing site stuff or CSS tweaking).

### A Tipping Point

This was just at the start of holidays, and it's been insane to see the progress I've been making in a tech stack I don't deeply understand. I've been doing most of the coding in-between family dinners, stolen hours here and there. Previously I needed dedicated focus time to get things done. Here, I could get into the flow within minutes, not hours.

This experience started to lay a strong belief that we reached a tipping point in how code is going to be generated. I still wanted to understand where the limits are. We've already been at a quite complex state, and wanted to understand where the "vibe coding crunch" of bugs after bugs and regressions comes. So we kept pushing very hard, but never, not up until today did we reach this point.

## Where I Found My Edge

For me the breakthrough in working with coding agents has been not having the ability to understand the code itself. Something which I've also been experiencing for the good part of my career when working with web and backend teams. As for my background, I'm a strong iOS/UIKit design focused engineer with 20+ years of experience, but haven't built prod systems on other platforms. I am for the last 6 years "acting" CTO at Craft, and we have a deep, technically complex product. And I could use my architectural, problem solving and pattern matching skills very effectively. A simple change touches 20 files? Let's understand root cause, refactor if needed. A feature keeps breaking again and again? Let's identify and fix the fragile parts before moving forward...

## 100% AI-Written, But Not Detached

100% of the code has been written by Claude, but we have made a huge amount of architectural and technological decisions. Most of them came from our direct experience of building software for the last 20 years. Gyula, who is an experienced PM/Engineer has also been working with me during the last few weeks on this, so I wasn't fully solo.

Building was fast, but not easy. We relied extensively on our deep experience of building modern productivity software: UX, UI, business logic, data flows etc. So I do feel a lot of **me** in it. I'm not detached. Refining the pixels, animations, pulling it all together was where I really felt I am absolutely the one making very detailed decisions.

---

## The Open Source Opportunity: Remixing Software

Craft Agents is an opinionated piece of software. It works amazingly for me, and a big chunk of our team, but different people have different workflows and often, very specific needs. Building productivity software teaches you this: there's no one-size-fits-all.

We will never be able to build a great piece of product that works perfectly for everyone. But AI, and Coding Agents opens up unique opportunities for people to **remix and modify their tool**, from tiny details to complex features. Personal software will neither be customized nor built from scratch, but forked, and re-mixed.

So we're releasing Craft Agents as an open source product, with an **Apache 2.0 License**. You can download and use it directly from the website, fork it, improve it, build your taste into it. Make it truly yours.

This is our research preview. If you have any feedback, anything you like or miss, please let us know. We can't guarantee customer support, bug fixing etc for your use cases, but nothing stops you from doing this yourself!

Enjoy & Have Fun,

**[@BalintOrosz](https://x.com/BalintOrosz)** & **[@GyulaHalmos](https://x.com/GyulaHalmos)** at Craft
`

export default function BlogPage() {
  // Open markdown links in new tab
  const handleUrlClick = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <main className="relative z-10 min-h-screen flex flex-col items-center p-6 pt-[100px] pb-[128px]">
        {/* Back link */}
        <div className="max-w-[720px] w-full mb-8">
          <Link
            to="/"
            className="text-[13px] text-foreground/50 hover:text-foreground transition-colors"
          >
            &larr; Back to home
          </Link>
        </div>

        {/* Post header */}
        <div className="max-w-[720px] w-full mb-10">
          <time className="text-[13px] text-foreground/50 block mb-3">
            {postDate}
          </time>
          <h1 className="text-3xl font-extrabold leading-tight">
            Craft Agents: Our Take on Working Effectively with Agents
          </h1>
          <p className="text-[15px] text-foreground/60 mt-2 italic">
            Available Open Source
          </p>
        </div>

        {/* Post body */}
        <div className="markdown-content max-w-[720px] w-full text-[15px]">
          <Markdown onUrlClick={handleUrlClick}>
            {postContent}
          </Markdown>
        </div>
      </main>
  )
}
