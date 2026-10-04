/**
 * Plain-language headlines corrected or written during team review of the model's output.
 * Each one applies only while the rule still has the same official title, and it still has to
 * pass the same check as a model headline (every number must appear in the rule's own text).
 */
export const REVIEWED_HEADLINES: { rule: string; title: string; headline: string; why: string }[] = [
  {
    rule: "NJ-SCREEN-02",
    title: "Fair Chance in Housing Act: Criminal record screening restrictions",
    headline: "Your landlord can't ask about your criminal record until after offering you the apartment.",
    why: "Model wrote “job offer”; the law refers to a conditional offer of housing.",
  },
  {
    rule: "LA-EVICT-03",
    title: "'Mom and Pop' reduced relocation assistance for owner/family occupancy evictions",
    headline: "If a small landlord evicts you to move in, you get $10,550 to $21,250 to help you relocate.",
    why: "Model wrote “may pay”; these are the reduced amounts small landlords must pay.",
  },
  {
    rule: "BER-EVICT-01",
    title: "Notice of Tenant Rights at Start of Tenancy",
    headline: "Within 15 days of move-in, your landlord must tell you in writing whether rent control covers your unit.",
    why: "Model omitted what the 15 days count from.",
  },
  {
    rule: "BER-EVICT-03",
    title: "Owner move-in eviction relocation assistance payment",
    headline: "If your landlord evicts you to move in, they must pay you $19,413 to help you relocate.",
    why: "No model headline returned.",
  },
  {
    rule: "BER-DEP-03",
    title: "Berkeley Rent Stabilization and Just Cause Eviction Ordinance - Multifamily Buildings Built Before 1980",
    headline: "In most multifamily buildings built before 1980, your security deposit must earn interest.",
    why: "Same headline as BER-DEP-02; this source states the coverage instead.",
  },
  {
    rule: "SD-EVICT-01",
    title: "Notice and Relocation Assistance for No-Fault Terminations",
    headline: "If you're evicted through no fault of your own, your landlord must pay you 2 months' rent (3 if senior or disabled).",
    why: "Shortened.",
  },
  {
    rule: "SF-EVICT-01",
    title:
      "San Francisco Relocation Payments for Owner/Relative Move-in, Demolition, Capital Improvement, and Substantial Rehabilitation Evictions",
    headline: "If you're evicted for an owner move-in or major work, you get $8,245 per tenant to help you relocate.",
    why: "Model headline was cut off at the length limit.",
  },
  {
    rule: "SF-RENT-01",
    title: "San Francisco Annual Rent Increase for March 1, 2026 - February 28, 2027",
    headline: "Your landlord can raise your rent by no more than 1.6% between March 2026 and February 2027.",
    why: "Reworded the date range.",
  },
  {
    rule: "LA-DEP-01",
    title: "Interest Payments on Security Deposits",
    headline: "Your landlord must pay you interest on your security deposit.",
    why: "Removed agency name.",
  },
  {
    rule: "BOS-SCREEN-01",
    title: "Boston Fair Chance Tenant Selection Policy—Criminal History Screening Restrictions",
    headline: "If your housing is city-funded or income-restricted, your landlord can't reject you over an arrest record.",
    why: "Model headline left out that the policy covers only city-funded and income-restricted housing.",
  },
  {
    rule: "LA-RENT-01",
    title: "Rent Increase Prohibition - COVID-19 Relief",
    headline: "Your landlord couldn't raise your rent from March 2020 through January 2024.",
    why: "The freeze has ended; the model wrote it as current.",
  },
  {
    rule: "LA-ALG-P1",
    title: "Report on Algorithm-Based Rent-Setting Software",
    headline: "The city would study banning rent-pricing software; it isn't a rule for your landlord yet.",
    why: "No accepted model headline.",
  },
  {
    rule: "MA-RENT-P1",
    title: "Initiative Petition 25-21: Limit on Annual Rent Increases",
    headline: "A proposed cap on your rent increases (5% or inflation, whichever is lower) did not become law.",
    why: "No accepted model headline.",
  },
  {
    rule: "MA-RENT-01",
    title: "State prohibition on local rent control, with limited exceptions",
    headline: "Your city or town can't put rent control on your apartment.",
    why: "No accepted model headline.",
  },
  {
    rule: "JC-RENT-01",
    title: "Jersey City Rent Control Ordinance",
    headline: "If your building is under rent control, your rent increases are limited.",
    why: "No accepted model headline.",
  },
];
