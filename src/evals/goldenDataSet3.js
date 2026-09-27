[
  {
    "id": 1,
    "question": "How much electricity did Kestrel generate in Q1 FY2025?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "1,840 GWh (April to June 2024).",
    "category": "chart_read"
  },
  {
    "id": 2,
    "question": "What was Kestrel's electricity generation in Q3?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "1,510 GWh in fiscal Q3 FY2025 (October to December 2024). The report uses fiscal quarters; if calendar Q3 (July to September 2024) is meant, that is fiscal Q2, with 1,720 GWh.",
    "category": "ambiguity"
  },
  {
    "id": 3,
    "question": "What share of FY2025 generation came in the fourth quarter?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "About 24.3%: 1,630 GWh out of a total of 6,700 GWh.",
    "category": "chart_computation"
  },
  {
    "id": 4,
    "question": "What was Harrow Point's availability in July 2024?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "98%.",
    "category": "chart_read"
  },
  {
    "id": 5,
    "question": "Which plant had the lowest availability in November 2024, and who manages it?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "Saltmarsh, at 78%, managed by Anil Rao.",
    "category": "chart_multi_hop"
  },
  {
    "id": 6,
    "question": "Which plant had the lowest availability in January 2025, and why?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "Tern Ridge, at 81%, because its turbine upgrade was being carried out in January. The upgrade was completed on 18 February 2025.",
    "category": "chart_multi_hop"
  },
  {
    "id": 7,
    "question": "What was Pine Hollow's availability in November 2024?",
    "target_parent_chunk_id": null,
    "expected_answer": "The document does not report it. Figure 4.2 shows availability only for Tern Ridge, Saltmarsh and Harrow Point.",
    "category": "chart_unanswerable"
  },
  {
    "id": 8,
    "question": "How much revenue did grid services generate in FY2025?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "About ₹1,562 crore: 11% of total revenue of ₹14,200 crore.",
    "category": "chart_computation"
  },
  {
    "id": 9,
    "question": "What is the capacity of Tern Ridge?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "465 MW, following the turbine upgrade completed on 18 February 2025. It was 420 MW before the upgrade and 380 MW when commissioned in 2011.",
    "category": "override_chain"
  },
  {
    "id": 10,
    "question": "What was Kestrel's total available generating capacity at the end of FY2025?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "1,365 MW: 1,320 MW available at 31 December 2024 (excluding the mothballed Brackenfield plant), plus 45 MW from the Tern Ridge upgrade from 420 MW to 465 MW.",
    "category": "override_computation"
  },
  {
    "id": 11,
    "question": "Is Brackenfield counted in Kestrel's available capacity?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "No. Brackenfield has been mothballed since 15 November 2024 and is excluded from available capacity.",
    "category": "footnote_exception"
  },
  {
    "id": 12,
    "question": "Which region had the most lost-time injuries in FY2025, and who is its regional director?",
    "target_parent_chunk_id": ["PENDING", "PENDING", "PENDING"],
    "expected_answer": "Coastal, with 7 lost-time injuries after the erratum corrected Table 6.1 from 4 to 7. Its regional director is Farhan Siddiqui.",
    "category": "erratum_multi_hop"
  },
  {
    "id": 13,
    "question": "Did lost-time injuries fall in FY2025 compared with FY2024?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "No. After the erratum, FY2025 lost-time injuries total 18 (3 + 6 + 7 + 2), compared with 17 in FY2024, an increase of one. The figure of 15 in the CEO's letter and the safety section predates the correction.",
    "category": "erratum_conflict"
  },
  {
    "id": 14,
    "question": "Where did the late-reported safety incidents happen?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "At Harrow Point in the Coastal region. There were three incidents in March 2025, reported after Table 6.1 was finalised.",
    "category": "erratum_detail"
  },
  {
    "id": 15,
    "question": "How many near misses were reported in the North region?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "41. The North-East region, reported separately, had 38.",
    "category": "lexical_trap"
  },
  {
    "id": 16,
    "question": "By how much did outage hours fall in FY2025?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "Unplanned outage hours fell by 18% (5,100 to 4,182). Total outage hours, including planned maintenance, fell by 12% (9,400 to 8,270). The CEO's 18% figure refers to unplanned outages only.",
    "category": "ambiguity_conflict"
  },
  {
    "id": 17,
    "question": "How many planned maintenance hours were there in FY2025?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "4,088 hours.",
    "category": "table_read"
  },
  {
    "id": 18,
    "question": "How much would a household using 250 kWh have paid for electricity in December 2024?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "₹1,212.50: 250 kWh at the FY2025 Slab 2 rate of ₹4.85 per kWh. The revised rate of ₹5.20 applies only from 1 April 2025.",
    "category": "date_override_computation"
  },
  {
    "id": 19,
    "question": "What rate per kWh will a household using 400 kWh a month pay from April 2025?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "₹6.75 per kWh, the revised Slab 3 rate from 1 April 2025 (up from ₹6.40).",
    "category": "date_override"
  },
  {
    "id": 20,
    "question": "What is the Slab 2 residential tariff?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "₹4.85 per kWh during FY2025, rising to ₹5.20 per kWh from 1 April 2025.",
    "category": "ambiguity_date"
  },
  {
    "id": 21,
    "question": "Did the regulatory update change the Slab 1 tariff?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "No. The Slab 1 rate stays at ₹3.10 per kWh.",
    "category": "unchanged_after_update"
  },
  {
    "id": 22,
    "question": "What will commercial customers pay per kWh from April 2025?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "₹8.60 per kWh, up from the FY2025 flat rate of ₹8.25.",
    "category": "date_override"
  },
  {
    "id": 23,
    "question": "What is the size and budget of the Pine Hollow battery project?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "80 MWh with a budget of ₹310 crore, after the board increased it on 20 March 2025 from the originally approved 60 MWh and ₹240 crore.",
    "category": "override"
  },
  {
    "id": 24,
    "question": "Which plants are covered by the Nordvik maintenance contract?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "Tern Ridge, Hollow Creek, Pine Hollow and Harrow Point. Saltmarsh is excluded because it is under the manufacturer's warranty until 2027, and Brackenfield is not an operating plant because it is mothballed.",
    "category": "exception_multi_hop"
  },
  {
    "id": 25,
    "question": "Why is Saltmarsh not covered by the Nordvik maintenance contract?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "It remains under its original warranty agreement with the turbine manufacturer until 2027.",
    "category": "exception"
  },
  {
    "id": 26,
    "question": "In which regions are all of the plants covered by the Nordvik maintenance contract?",
    "target_parent_chunk_id": ["PENDING", "PENDING", "PENDING"],
    "expected_answer": "North (Tern Ridge and Pine Hollow) and Central (Hollow Creek). Coastal is not, because Saltmarsh is excluded, and North-East is not, because its only plant, Brackenfield, is mothballed.",
    "category": "multi_hop_complex"
  },
  {
    "id": 27,
    "question": "What is Rao's role at Kestrel?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "There are two people named Rao: Dr. Anika Rao is the Chief Technology Officer, and Anil Rao is the plant manager at Saltmarsh.",
    "category": "name_ambiguity"
  },
  {
    "id": 28,
    "question": "What did the CTO say about the battery project?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "Dr. Anika Rao said the Pine Hollow battery would let Kestrel shift midday solar into the evening peak, when customers need it most.",
    "category": "lexical_synonym"
  },
  {
    "id": 29,
    "question": "Who is the regional director for the region where Hollow Creek is located?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "Helen Okafor, regional director for the Central region.",
    "category": "multi_hop"
  },
  {
    "id": 30,
    "question": "How many people work for Kestrel?",
    "target_parent_chunk_id": ["PENDING", "PENDING"],
    "expected_answer": "3,420 employees at 31 March 2025, plus 180 contract staff, for 3,600 in total. This is consistent with the CEO's reference to over 3,500 colleagues.",
    "category": "conflict_resolution"
  },
  {
    "id": 31,
    "question": "When was Pine Hollow commissioned?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "2022.",
    "category": "similar_names"
  },
  {
    "id": 32,
    "question": "How many employees work at Tern Ridge?",
    "target_parent_chunk_id": null,
    "expected_answer": "The document does not give plant-level headcount. It only reports employees by region; the North region, which includes Tern Ridge, had 1,050.",
    "category": "unanswerable_trap"
  },
  {
    "id": 33,
    "question": "What was the CEO's total pay in FY2025?",
    "target_parent_chunk_id": null,
    "expected_answer": "The document does not state the CEO's pay.",
    "category": "unanswerable"
  },
  {
    "id": 34,
    "question": "How much electricity was generated in Q1 FY2024?",
    "target_parent_chunk_id": null,
    "expected_answer": "The document does not give quarterly figures for FY2024, only the FY2024 total of 7,050 GWh.",
    "category": "unanswerable_trap"
  },
  {
    "id": 35,
    "question": "What share of FY2025 emissions came from the plant that was mothballed?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "61%. Brackenfield was mothballed on 15 November 2024 and accounted for 61% of FY2025 emissions.",
    "category": "multi_hop"
  },
  {
    "id": 36,
    "question": "Has the Saltmarsh cable damage been fully repaired?",
    "target_parent_chunk_id": "PENDING",
    "expected_answer": "Partly. Temporary repairs completed in March 2025 restored full export capability, but the permanent cable replacement is still under way and expected to finish in FY2026.",
    "category": "temporal_status"
  }
]
