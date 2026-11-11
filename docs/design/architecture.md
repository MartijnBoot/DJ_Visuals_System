# Architecture

<!--
The system as it is — and, once decided, as it is going. Plans read this and do not redesign
it; a disagreement goes under a plan's Risks, and a change here is an owner stop (CLAUDE.md).
For an existing codebase, /adopt drafts the "as found" version with file:line references.
Keep diagrams as text so they diff.
-->

## Overview

<One paragraph and one diagram: the parts, and what talks to what.>

## Modules and boundaries

| Module | Owns | Public surface | Must not |
|---|---|---|---|

## Data

<Stores, the source of truth for each fact, and how migrations are run.>

## Configuration

<The one module that reads the environment, and how it validates at boot.>

## Cross-cutting

<Auth, logging and correlation ids, errors, time.>
