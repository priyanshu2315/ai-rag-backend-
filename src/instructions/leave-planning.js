export function getLeavePlanningInstructions(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return `LEAVE & LONG-WEEKEND PLANNING (applies only to leave-planning questions):
Trusted current date: ${today} (Asia/Kolkata). This date comes from the server clock.
- Unless the user explicitly requests another period, recommend leave dates on or after the trusted current date. Interpret "from now", "upcoming", and an unspecified year using that date. Exclude expired opportunities; do not list the entire year's past holidays.
- Use only retrieved company holidays and applicable leave/working-week policies. Do not invent public holidays, transfer old calendar dates to another year, or treat a holiday from another year as upcoming. Preserve source qualifications such as moon-dependent dates.
- Follow an explicitly supplied user work schedule or a documented company schedule. If neither defines the weekend, proceed with the clearly labelled assumption "Assuming Saturday and Sunday are your weekly days off". This is a planning assumption, NOT a confirmed company policy; do not refuse solely because weekend days were not retrieved. Explicit working Saturdays or other schedule exceptions take precedence over this default.
- Retrieve the holiday dates and any available schedule restrictions. Always also search for the leave policy that governs combining leave with holidays, including restricted holiday (RH) rules and any "cannot be clubbed" or sandwich-leave conditions, even if the user does not mention them. If any holiday is marked restricted, optional, or RH, treat its clubbing rule as a required fact before recommending leave next to it. Do not recommend leave adjacent to a holiday that the policy says cannot be clubbed with leave; explain the restriction and offer the next valid option instead. Calendar arithmetic, this trusted date, and the labelled weekend assumption are not additional document facts requiring evidence hops or source quotes. Do not keep searching solely to prove the default weekend assumption.
- Answer "which leave should I take?" with specific WORKING dates to request. Always consider a working Friday when it extends a holiday/weekend into one continuous break. If Friday is already a holiday or a weekly day off, do not count it as leave; consider the adjacent working Thursday or Monday and explain the alternative. Follow an explicit Friday-only preference if the user gives one.
- A working Friday followed by a Saturday-Sunday weekend is itself a valid three-day break with one leave day, even without an adjacent company holiday. Offer the next such Friday as a basic option when appropriate, clearly marked as based on the stated weekend assumption or documented schedule; do not invent a holiday to justify it.
- Calculate each continuous break day by day. Count only requested working days as leave; include intervening holidays and weekly days off in the total break. If an intervening working day also needs leave, list it explicitly. Never connect dates across an unlisted working day.
- Prefer useful extensions with few leave days, and include a Friday-based option when supported. If a break already exists without leave, show how taking an adjacent working day could extend it. Do not end with only "already a long weekend; do not take leave" when an extension is possible. Keep zero-leave breaks secondary to actual leave recommendations.
- Lead with a concise recommendation, then a compact table: Leave date(s) with weekday | Leave days needed | Continuous break (start–end) | Total days off | Holiday/source. Verify weekdays against the actual year. Distinguish one-day options from optional longer extensions.
- Cite the document passages establishing the holiday and policy inputs. Label assumptions and calendar-derived calculations separately; never claim the documents explicitly state your calculated leave recommendations. If no supported future opportunity exists, say so rather than inventing one. Approval and leave eligibility must not be presented as guaranteed.`;
}
