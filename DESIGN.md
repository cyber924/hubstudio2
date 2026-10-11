# Hub Studio 2: Editorial Design Specification

## 1. Target Audience & Representative Scenario
- **Target Audience**: Travel writers, lifestyle bloggers, magazine editors, and visual creators who curate stories about journeys, slow living, and unique spaces.
- **Representative Scenario**: A travel blogger discovers stunning photos of a cozy Jeju coastal cafe in the Common Image Hub. They curate these images, generate a cohesive editorial plan (e.g., "Slow Travel: Jeju's Hidden Cafes"), write/generate a beautifully sectioned blog post, review it for visual-text alignment, replace any mismatched images with closer lifestyle fits from the hub, and publish it to the public magazine view.

## 2. Brand Identity & Visual Tone
- **Name**: 허브스튜디오2 (Hub Studio 2)
- **Key Slogan**: "여행과 삶을 담는 비주얼 매거진" (Visual Magazine for Journeys and Life)
- **Visual Tone**: Warm, minimalist, intellectual, and high-end editorial. Emphasizes spacious layout, breathtaking photography, and fluid reader experiences.

## 3. Design System & Palette (60-30-10 Rule)
- **60% Dominant Neutral Canvas**: Warm Ivory / Off-White (`#FAF9F6` or `bg-neutral-50`) providing a high-legibility bookish backdrop.
- **30% Structural Surfaces**: Rich Charcoal (`#1C1A17` or `text-neutral-800`), clean hairline borders (`border-neutral-200/60`), and subtle warm-grey cards.
- **10% Accent Accent**: Editorial Terracotta Red (`#B23B1E` or `text-amber-800`) used purposefully for active navigation links, focal buttons, and primary CTAs.
- **Typography pairing**:
  - *Headlines*: Classy Editorial Serif (`font-serif`, tracking-tight, balanced text wraps).
  - *Body prose*: Highly legible Geometric Sans (`font-sans`, leading-relaxed, text-neutral-700, 15px-16px, maximum width of 65ch-75ch for optimal reading).
  - *Metadata & Numbers*: Tabular Monospace (`font-mono tracking-widest text-xs text-neutral-400`).

## 4. Information Architecture & Spatial Rhythm
- **Top Navigation (3-Zone Contract)**:
  - *Zone 1*: Single Wordmark brand logo `Hub Studio 2` in classy serif.
  - *Zone 2*: Navigation menu with single-line unboxed text items: `Magazine Gallery` · `Creator Studio` · `Agent Co-Pilot` · `My Projects`.
  - *Zone 3*: Accent CTA button `Sign In` / `Sign Out` and User Profile indicators.
- **Spacious Layouts**: Section margin padding >= inner child spacing. Use subtle 1px dividers rather than rounded card borders within cards.
- **Zero-Pill Metadata**: Tags, dates, and author categories are rendered as clean unboxed typography with dot (`·`) or slash (`/`) separators instead of colored badge capsules.

## 5. Mobile Layout & Lower Actions Budget
- **Aggregate Sticky Height**: Under 15% of mobile viewport height.
- **Mobile Drawer**: Collapsible thumb-friendly navigation bar on mobile view.
- **Split Agent View**: Toggles between thread history and visual workspace on narrow screens to maximize work room.
