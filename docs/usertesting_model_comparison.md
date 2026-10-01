# User Testing Structures for 12 Testers

Context: 12 testers, 3 feedback-form designs (A/B/C).

## Overview

| Setup | Distribution | Pros | Cons |
|---|---|---|---|
| **1. Pure between-subjects** | 4 A / 4 B / 4 C | Most natural first-time experience. No comparison bias. No learning/carryover between interfaces. Closest to how a real player would encounter the system. | Only **n=4 per design**. One participant changes results by 25%. Weak for quantitative comparisons. Individual differences can easily dominate results. |
| **2. Full within-subjects** | All 12 use A, B and C | **n=12 for every design**. Strongest statistical efficiency with such a small sample. You can directly compare what the same person thinks of each version. | Strong risk of comparison bias. Participants realize what is being tested. Second/third interface is no longer a natural first encounter. Fatigue and learning effects. |
| **3. Full within-subjects + counterbalanced order** | 2 people for each of the 6 orders: ABC, ACB, BAC, BCA, CAB, CBA | Same benefits as within-subjects, but order effects are distributed evenly. Very neat design with exactly 12 testers. | Does **not remove** comparison/carryover effects; it only balances them. Session becomes longer. Still less natural than seeing one interface. |
| **4. Pairwise incomplete within-subjects** | 4 AB / 4 AC / 4 BC | Each design gets **8 testers** rather than 4. Nobody sees all three. Less fatigue and comparison than full within-subjects. Allows direct comparisons. | The second design is still influenced by the first. More complicated analysis. Still not a completely natural first encounter. |
| **5. Between-subjects + repeated use** | 4 A / 4 B / 4 C, but each person uses their assigned form several times | Preserves natural condition separation while giving many behavioral observations. Good for seeing whether people continue giving feedback after the novelty wears off. | Participant-level sample is still only **n=4 per condition**. Multiple submissions from one person are not independent participants. AI craft quality can affect individual feedback events. |
| **6. First-exposure between-subjects → later comparison** | First: 4 A / 4 B / 4 C. Afterwards everyone can inspect/test the other versions | Gives uncontaminated **first-exposure data** plus richer preference information afterward. Lets participants explain why they prefer one interaction. | Primary and later comparison data must be analyzed separately. Later preference data is comparative and no longer natural first-use behavior. Longer session. |
| **7. Between-subjects + interview/mockups afterward** | 4 A / 4 B / 4 C during gameplay; afterward show screenshots/videos of alternatives | Keeps gameplay test uncontaminated while still collecting opinions about alternatives. Shorter than having them perform every condition. | Stated preference from screenshots is weaker than actual interaction. What users think they would prefer may differ from actual behavior. |
| **8. Two-condition study only** | 6 A / 6 B; remove C | Stronger between-subject comparison. 6 per condition is still small, but better than 4. Easier analysis and thesis narrative. | Requires dropping one concept or testing it separately during formative testing. No three-way comparison. |

---

## Recommended Structure for Asciia Bay

### Option A — Between-subjects + repeated use

Assign each participant to only one interface:

- 4 participants → A
- 4 participants → B
- 4 participants → C

Each participant encounters the assigned feedback interface several times during normal play.

Example:

1. Craft 1 → feedback opportunity
2. Craft 2 → feedback opportunity
3. Craft 3 → feedback opportunity

Possible measures:

- Feedback completion rate
- Whether participants continue giving feedback after the first occurrence
- Time to submit
- Number of tags selected
- Whether the one-sentence comment field is used
- Comment length
- Number of distinct useful feedback points
- Whether the interaction is abandoned halfway through
- Perceived ease
- Perceived interruption
- Whether the player felt able to express what they wanted
- Willingness to use the feedback option voluntarily again

Important: If four participants each submit feedback three times, that creates 12 feedback interactions, but the independent participant sample is still **n=4** for that condition.

---

### Option B — First-exposure between-subjects + comparison afterward

#### Phase 1: Primary gameplay test

Each participant sees only one feedback system.

Do not tell participants during this phase that multiple versions exist.

After using the system, collect short ratings such as:

- “Giving feedback was easy.”
- “Giving feedback interrupted my play.”
- “I could express what I wanted to say.”
- “I would voluntarily use this feedback option again.”

This gives natural first-use data.

#### Phase 2: Comparative discussion

Only after all primary measurements are complete, show the participant the other two versions.

Possible questions:

- Which version would you personally prefer?
- Which looks fastest to use?
- Which seems easiest to understand?
- Which gives you the best chance to explain your opinion?
- What do you like or dislike about each?

Keep this dataset separate from the Phase 1 results.

---

## Why not simply let everyone test A → B → C?

Doing so can introduce:

- comparison bias
- learning effects
- fatigue
- carryover effects
- demand characteristics
- altered expectations after seeing the first design

By the second or third condition, participants may no longer evaluate the interface naturally. Instead, they may actively compare features across versions.

That setup is still useful when the research question is:

> Which interface do users prefer when directly comparing alternatives?

It is less ideal when the research question is closer to:

> Which feedback design allows players to provide useful medium-detail feedback with low perceived friction?

---

## Possible Interpretation of Results

With only four participants per condition, quantitative results should be treated as **exploratory**.

For example:

| Measure | A | B | C |
|---|---:|---:|---:|
| Participants | 4 | 4 | 4 |
| Feedback opportunities | 12 | 12 | 12 |
| Completed | 11 | 7 | 10 |
| Comments used | 6 | 2 | 7 |
| Mean tags selected | 1.8 | 1.1 | 2.0 |
| Useful feedback points | 17 | 8 | 20 |

This can reveal patterns, but it should not be described as proving that one design is universally better.

A suitable thesis phrasing would be:

> “Design A showed the most favorable pattern in this exploratory sample.”

rather than:

> “Design A was proven to be the best design.”
