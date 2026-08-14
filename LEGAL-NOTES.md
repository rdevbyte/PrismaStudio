# Notes on the PHI guard and liability

**I am not a lawyer and this is not legal advice.** The paragraphs below are engineering context to take to a qualified attorney — ideally one who works on healthcare privacy (HIPAA) and, since you mentioned school data, education privacy (FERPA).

---

## The short version

**A click-through waiver does not make HIPAA go away.**

HIPAA liability doesn't work like a gym membership, where a signed release ends the matter. The key points to discuss with counsel:

1. **HIPAA obligations attach by role, not by agreement.** They apply to *covered entities* (providers, plans, clearinghouses) and their *business associates*. If your tool processes PHI on behalf of a covered entity, you may be a business associate by function — and a user ticking a box doesn't change that classification. What's normally required is a **Business Associate Agreement (BAA)**, which is a negotiated contract with real obligations on you, not a checkbox.

2. **A user generally cannot waive duties owed to third parties.** The person uploading a file is not the patient. A school administrator or claims analyst has no authority to sign away the privacy rights of the individuals *in* the data. That's the core weakness of a "user accepts all liability" clause here: the people actually harmed by a breach never agreed to anything.

3. **Regulators aren't bound by your terms.** HHS Office for Civil Rights can act regardless of what your ToS says. Contract terms can allocate risk *between you and your user*; they cannot bind a regulator or a patient.

4. **Indemnity clauses have real but limited value.** An indemnity where the user agrees to cover losses from their own misuse is standard and worth having. But it's only as good as the user's ability to pay, it's often unenforceable against consumers, and it does nothing about regulatory action.

5. **FERPA is a separate regime.** Student records have their own rules (and state laws like NY Ed Law 2-d, California's SOPIPA, and similar). A HIPAA-focused waiver wouldn't address them. Worth flagging to counsel since school data is your actual use case.

---

## What genuinely reduces your exposure

Your strongest defence is already built in, and it's architectural rather than contractual:

**The data never reaches you.** Everything runs in the browser. There is no upload, no server-side processing, no storage, no logging, no analytics. The CSP header sets `connect-src 'none'`, which means the browser itself blocks outbound network calls — this is verifiable by any third party, not just a promise in a policy.

That is a far better position than a waiver. A tool that never receives data is in a very different posture from one that receives it under a disclaimer. Make sure your counsel understands this properly, because it materially changes the analysis. Concretely:

- No PHI is transmitted to or stored on your infrastructure
- You have no access to user data at any point
- There is nothing to breach on your side, because nothing persists
- Users can verify all of this by opening DevTools or reading the source

Point counsel at `PRIVACY.md`, the CSP in `vercel.json`, and the fact the whole app is one auditable file.

---

## What I built instead of a waiver

I deliberately did **not** add a "sign here to release me from all liability" flow, because it would give you false confidence while providing little actual protection.

What's there now is an **attestation**, which is narrower and more honest:

> ☐ I confirm this file contains **no protected health information** and that I am authorised to analyse it.

Why this framing is better:

- It's a **factual claim by the user**, not a purported waiver of third-party rights. Users asserting facts about their own data is a normal, defensible pattern.
- It's **specific and unmissable** — the "Analyse anyway" button stays disabled until it's ticked.
- It's **recorded** — the timestamp, filename and matched terms are held for the session and printed into any exported report, so the bypass is documented.
- It **doesn't overclaim.** It never says "you accept all liability for anything that happens," which is the part most likely to be struck down anyway and which can look bad if it's ever examined.

The attestation is in-memory only, consistent with the zero-persistence guarantee. If you need durable proof of consent, that requires storing something — and storing an audit log is a product decision with its own privacy consequences. Discuss with counsel before adding it.

---

## Questions worth taking to a lawyer

1. Given the tool is 100% client-side and never receives data, am I a business associate at all?
2. Does the attestation model hold up, or do I need a clickwrap ToS accepted before first use?
3. Do I need separate FERPA language for school users, and does that change per state?
4. Should the entity be structured (LLC etc.) to limit personal exposure?
5. Does insurance (tech E&O / cyber) make sense at my scale?
6. If I ever add server-side features, what changes? **This is the big one** — the moment data touches your infrastructure, the entire analysis above stops applying.

---

## On the false positives you hit

Worth knowing that the original block on your school file was **a bug, not a policy decision**:

- `"phi"` was matched as a bare substring, so **Philosophy**, **Philadelphia**, **Sophia**, **Memphis**, **Delphi**, **graphic_design** and **trophies** all tripped it.
- Your "No PHI" note only counted if it appeared in the first 40 rows.

Both are fixed. Matching is now word-boundary based and weighted: unambiguous clinical identifiers (MRN, ICD-10, patient, prescription) block on their own, while softer words (immunization, clinical, hospital) need to appear together, and more of them in an obvious education context. The declaration is now detected anywhere in the file.

So the guard should stop getting in your way on legitimate school data — and the attestation is there for the residual cases rather than as your primary legal strategy.
