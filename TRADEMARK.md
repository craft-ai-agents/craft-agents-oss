# Trademark Policy

This policy covers the use of the "ARCHstudio" name, logo, and branding in
connection with the ARCHstudio open source project, and explains how this
project relates to the trademarks of the upstream project it was forked from.

## Background

ARCHstudio is a fork of
[craft-agents-oss](https://github.com/lukilabs/craft-agents-oss), originally
built by Craft Docs Ltd. and released under the Apache License 2.0. The fork is
independent: it is not produced, endorsed, or supported by Craft Docs Ltd.

## Trademarks

**"Craft" and "Craft Agents" are trademarks of Craft Docs Ltd.**, as are the
Craft logo and icon. This project claims no rights in them and uses the terms
only where factually accurate — for example, to identify the upstream project or
to name the Craft MCP integration.

**"ARCHstudio" is the name of this project.** It is not a Craft Docs Ltd.
trademark, and this project does not license it under the Apache 2.0 grant that
covers the source code.

## What You Can Do

### Use the Code Freely

The ARCHstudio source code is licensed under the Apache License 2.0. You are
free to:

- Use, modify, and distribute the code
- Create derivative works
- Use the software for any purpose, including commercial use

### Make Factual Statements

You may make accurate, factual statements about your relationship to the
project:

- "Based on ARCHstudio"
- "Built with ARCHstudio technology"
- "Compatible with ARCHstudio"
- "Fork of ARCHstudio"

## What You Cannot Do

### Use ARCHstudio Branding for Your Own Fork

If you fork this project, you **must**:

- Choose a different name that does not include "ARCHstudio"
- Remove or replace the ARCHstudio logo and icons
- Update the bundle identifier (`com.skobez.archstudio` in
  `apps/electron/electron-builder.yml`) to your own
- Update the repository and service URLs in
  `packages/shared/src/branding.ts`

The same obligations that this project inherited from the upstream policy apply
to anyone forking this project.

### Use Craft Branding

Independently of this project's own policy, you may not use "Craft", "Craft
Agents", or Craft logos for your product, and you may not suggest that Craft
Docs Ltd. produces or endorses it.

### Imply Official Endorsement

You may not:

- Use "ARCHstudio" as your own product name
- Use the ARCHstudio logo as your application icon
- Suggest that your fork is the official version
- Imply that this project endorses your product

## Branding Locations

For those creating forks, the following files contain branding that should be
updated:

| File | Contains |
|------|----------|
| `apps/electron/electron-builder.yml` | Product name, bundle ID, copyright |
| `apps/electron/resources/` | Application icons |
| `packages/shared/src/branding.ts` | Repository and service URLs |

## Examples

### Acceptable

- "MyAgent - based on ARCHstudio"
- "This project is a fork of ARCHstudio"
- "Compatible with the ARCHstudio ecosystem"

### Not Acceptable

- "ARCHstudio Pro"
- "Better ARCHstudio"
- Using the ARCHstudio logo for your fork
- Any use of Craft branding for your fork

## Questions

If you have questions about this policy, please open an issue in this
repository. Questions about Craft trademarks should go to Craft Docs Ltd., not
to this project.

## Changes

This policy may be updated from time to time. The current version will always be
available in this repository.

---

*This trademark policy is inspired by similar policies from Mozilla, WordPress,
and the Apache Software Foundation. It is not legal advice; have it reviewed by
counsel if trademark use matters to your deployment.*
