[
  {
    "id": 1,
    "question": "What is the domestic dinner allowance for a Tier B employee?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000004",
    "expected_answer": "65 USD.",
    "category": "table_distractor"
  },
  {
    "id": 2,
    "question": "How much can a Tier C employee claim for lunch while travelling in Germany?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000004",
    "expected_answer": "30 USD, from the international per diem table.",
    "category": "table_distractor"
  },
  {
    "id": 3,
    "question": "What is the current nightly hotel cap in London?",
    "target_parent_chunk_id": [
      "00000000-0000-0000-0002-000000000003",
      "00000000-0000-0000-0002-000000000007"
    ],
    "expected_answer": "465 USD, per Addendum B, which superseded the earlier 420 USD cap.",
    "category": "superseded"
  },
  {
    "id": 4,
    "question": "Was the Group 1 hotel cap raised to 500 USD?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000007",
    "expected_answer": "No. Proposed Addendum C would have raised it to 500 USD, but the Finance Committee rejected it on 12 July 2026. The cap remains 465 USD.",
    "category": "rejected_amendment"
  },
  {
    "id": 5,
    "question": "A Senior Engineer is taking a 9-hour flight. Which class of service may they book?",
    "target_parent_chunk_id": [
      "00000000-0000-0000-0002-000000000000",
      "00000000-0000-0000-0002-000000000002"
    ],
    "expected_answer": "Premium Economy, because Senior Engineers are Tier B and a 9-hour segment is long-haul.",
    "category": "multi_hop"
  },
  {
    "id": 6,
    "question": "Can a Tier C employee fly Premium Economy on a 9-hour flight?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000007",
    "expected_answer": "Yes. Addendum B permits Premium Economy for Tier C on segments exceeding 8 hours, replacing the earlier 10-hour threshold.",
    "category": "superseded"
  },
  {
    "id": 7,
    "question": "Do I need VP approval to book a flight 3 days before departure for a customer emergency?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000002",
    "expected_answer": "No. Customer-emergency travel is exempt from all advance-booking rules.",
    "category": "exception"
  },
  {
    "id": 8,
    "question": "Is valet parking at the airport reimbursable if it costs less than 25 USD per day?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000005",
    "expected_answer": "No. Valet parking is never reimbursable.",
    "category": "negation"
  },
  {
    "id": 9,
    "question": "Who must approve an expense report totalling 6,200 USD?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000001",
    "expected_answer": "The owner of the traveler's cost center, because the report exceeds 5,000 USD.",
    "category": "conditional"
  },
  {
    "id": 10,
    "question": "What is the per diem on the departure day for a Tier A employee travelling to Japan?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000004",
    "expected_answer": "123.75 USD, which is 75% of the 165 USD international daily maximum.",
    "category": "computation"
  },
  {
    "id": 11,
    "question": "A Tier B employee travelling in the US had lunch provided by a client. What is the most they can claim for meals that day?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000004",
    "expected_answer": "85 USD, which is the 115 USD domestic daily maximum minus the 30 USD lunch rate.",
    "category": "computation"
  },
  {
    "id": 12,
    "question": "Can I pay for my hotel with the purchasing card?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000006",
    "expected_answer": "No. The PCard must never be used for travel expenses, and doing so results in a 90-day PCard suspension on the first offense. Hotels must go on the TCard.",
    "category": "jargon"
  },
  {
    "id": 13,
    "question": "What extension should I call to reach the Travel Desk?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000006",
    "expected_answer": "4417.",
    "category": "exact_lookup"
  },
  {
    "id": 14,
    "question": "Does this policy cover travel by board members?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000000",
    "expected_answer": "No. Board of Directors travel is governed by policy NML-GOV-02.",
    "category": "scope"
  },
  {
    "id": 15,
    "question": "Can an intern be reimbursed for business travel?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000000",
    "expected_answer": "Only if the travel was pre-approved in writing by their department head.",
    "category": "conditional"
  },
  {
    "id": 16,
    "question": "What is the reimbursement limit for laundry services during a trip?",
    "target_parent_chunk_id": null,
    "expected_answer": "The document does not specify a reimbursement limit for laundry services.",
    "category": "unanswerable"
  },
  {
    "id": 17,
    "question": "What is the international per diem for Tier D employees?",
    "target_parent_chunk_id": null,
    "expected_answer": "The document does not define a Tier D. Only Tiers A, B and C exist.",
    "category": "unanswerable"
  },
  {
    "id": 18,
    "question": "What is the nightly hotel cap in Dubai?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000007",
    "expected_answer": "330 USD, because Addendum B reclassified Dubai from Group 3 to Group 2.",
    "category": "superseded"
  },
  {
    "id": 19,
    "question": "Do I need a receipt for a hotel night that cost 35 USD?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000005",
    "expected_answer": "Yes. Lodging always requires a receipt, regardless of the amount.",
    "category": "exception"
  },
  {
    "id": 20,
    "question": "I submitted my expense report 45 days after my trip ended. Will I be reimbursed?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000005",
    "expected_answer": "Only with approval from the cost-center owner, since it was submitted between 31 and 60 days after the trip.",
    "category": "conditional"
  },
  {
    "id": 21,
    "question": "Can I claim mileage for driving from my home to my regular office?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000005",
    "expected_answer": "No. Mileage is not reimbursed for the commute between home and the regular office.",
    "category": "negation"
  },
  {
    "id": 22,
    "question": "Can I choose a flight that costs 200 USD more than the cheapest option so I can earn miles?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000003",
    "expected_answer": "No. Choosing a flight to earn miles is prohibited when it costs more than 150 USD above the lowest logical fare.",
    "category": "conditional"
  },
  {
    "id": 23,
    "question": "I have a three-week assignment in Toronto. Can I stay in a hotel?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000003",
    "expected_answer": "No. Stays longer than 14 consecutive nights in one city must use a corporate apartment booked through the Travel Desk.",
    "category": "conditional"
  },
  {
    "id": 24,
    "question": "How many times a year can I use the missing receipt affidavit?",
    "target_parent_chunk_id": "00000000-0000-0000-0002-000000000005",
    "expected_answer": "Twice per calendar year, using form MRA-3.",
    "category": "exact_lookup"
  },
  {
    "id": 25,
    "question": "Can a Tier B employee fly Business class on a flight longer than 12 hours?",
    "target_parent_chunk_id": [
      "00000000-0000-0000-0002-000000000002",
      "00000000-0000-0000-0002-000000000007"
    ],
    "expected_answer": "No. Tier B is limited to Premium Economy on long-haul flights. Business class for Tier B was only in Proposed Addendum C, which was rejected.",
    "category": "rejected_amendment"
  }
]
