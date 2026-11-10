# Knowledge-base answer key (50 documents)

Synthetic test data for the made-up company Calderwick Pump Systems Ltd. Ground truth is in `FACT-SHEET.md`; HTML sources are in `source/`, PDFs in `pdf/`, and the generator for documents 6-50 is in `build/` (`node eval-docs/kb/build/build.mjs "<absolute path to eval-docs/kb>" [file prefix...]`; the 5 pilot sources were written by hand). Page numbers are PDF pages; "§" is the section number printed in the document.

## Documents (50 documents, 111 pages)

| Category (role) | Documents (pages) |
|---|---|
| HR (7) | HR-01 Staff Directory July 2025 (3); HR-02 Staff Directory January 2025 (3); HR-03 Employee Handbook v3 (5); HR-04 Travel and Expense Policy v1 (2); HR-05 Travel and Expense Amendment 1 (1); HR-06 Training and Certification Register 2025 (2); HR-07 Leave Policy and Holiday Calendar 2025 (2) |
| Finance (10) | FIN-01 Approval Matrix v1 (2); FIN-02 Approval Matrix v2 Amendment (2); FIN-03 Quarterly Report Q1 FY2026 (2); FIN-04 Quarterly Report Q2 FY2026 (2); FIN-05 Annual Financial Summary FY2025 (4); FIN-06 Budget FY2026 (2); FIN-07 Capital Expenditure Register (2); FIN-08 Purchase Order Log Jul-Sep 2025 (4); FIN-09 Internal Audit IA-2025-04 (2); FIN-10 Accounts Payable Procedure (2) |
| Procurement (10) | PRC-01 Brennock maintenance contract CON-2024-031 (3); PRC-02 Procurement Policy v4 (3); PRC-03 Vendor Master List (2); PRC-04 Ardent framework CON-2025-008 (2); PRC-05 Brennock Valve Supplies contract CON-2023-019 (2); PRC-06 Tarnfield haulage contract CON-2025-014 (2); PRC-07 Amendment CON-2024-031-A1 (2); PRC-08 Vendor Performance Review Q2 (2); PRC-09 Tender Evaluation TE-2025-03 (2); PRC-10 Supplier Code of Conduct (2) |
| Operations (9) | OPS-01 Project Register (2); OPS-02 Risk Register (2); OPS-03 Charter PRJ-11 (2); OPS-04 Charter PRJ-14 (2); OPS-05 Ardmoor report Aug 2025 (2); OPS-06 Ardmoor report Sep 2025 (2); OPS-07 Hollins Cross report Aug 2025 (2); OPS-08 Ardmoor Maintenance Plan (2); OPS-09 H&S Annual Report FY2025 (2) |
| IT (7) | IT-01 Incident INC-2025-014 (2); IT-02 IT Security Policy v2 (4); IT-03 Incident INC-2025-017 (2); IT-04 Incident INC-2025-021 (2); IT-05 Incident INC-2025-024 (2); IT-06 Access Review Q2 (2); IT-07 Disaster Recovery Plan (2) |
| Board & Legal (7) | BRD-01 Board minutes 14 Mar 2024 (2); BRD-02 Board minutes 12 Dec 2024 (2); BRD-03 Board minutes 19 Jun 2025 (2); BRD-04 Board minutes 18 Sep 2025 (2); LEG-01 Compliance Register (2); LEG-02 Audit Committee Report FY2025 (2); LEG-03 Contract Signing Authority (1) |

Longest documents: HR-03 Employee Handbook (5 pages); IT-02, FIN-05 and FIN-08 (4 pages each).

## Questions

Type key: **chain** = facts from several documents; **version** = a later document changes an earlier one; **lookalike** = similar names or codes; **calc** = needs arithmetic; **negative** = the right answer says the documents do not contain it.

### Q1. Who had to approve purchase order PO-10234? (chain, version; 4 documents)
**Expected:** Marcus Ebner, acting Head of Procurement (band B), and Dev Malhotra, Head of IT (rule CA-1).

| Hop | Fact | Where |
|---|---|---|
| 1 | PO-10234 raised 18 August 2025, USD 64,800, OT hardware | IT-01 p2 §5 action 1 (also FIN-08 p2 Table 1) |
| 2 | POs raised on or after 1 July 2025 follow FIN-AAM-02 | FIN-02 p1 §1 |
| 3 | Band B 10,001 to 75,000: Head of Procurement | FIN-02 p1 §3 Table 1 |
| 4 | CA-1: IT and OT above USD 20,000 needs the Head of IT | FIN-02 p2 §4 |
| 5 | Marcus Ebner acting Head of Procurement 4-22 August 2025; Head of IT Dev Malhotra | HR-01 p3 §3; HR-01 p1 §2 |

Traps: FIN-AAM-01 gives the CFO (Tobias Renwick); missing the acting appointment gives Linnea Haugland.

### Q2. How much service credit can Calderwick claim for incident INC-2025-014? (calc; 2 documents)
**Expected:** USD 925 = 5% of the USD 18,500 monthly fee (P1 restore missed: 11 h 20 min against 8 h; response 1 h 35 min met the 2 h target).
Where: IT-01 p1 control block and §3; PRC-01 p1 §4 (fee), p3 Appendix A. Also stated in PRC-08 p2 Table 2 and FIN-04 p2 Table 3.

### Q3. Who must claim the service credit for the TR-3 outage, and by when? (chain, lookalike; 3 documents)
**Expected:** Ingrid Solvang (Procurement Manager, Plant Services, the contract owner), in writing by 30 September 2025 (30 days after the end of August). She claimed it on 12 September 2025.
Where: IT-01 p2 §5 action 2; PRC-01 p1 §5 and p2 §7; HR-01 p2 §2 (E-1021); PRC-08 p2 Table 2. Trap: Ingrid Solberg (E-1024) is a Category Buyer, Packaging.

### Q4. What is the CFO's purchase approval limit? (version; 2 documents)
**Expected:** From 1 July 2025, POs of USD 75,001 to 200,000; before, USD 50,001 to 250,000.
Where: FIN-02 p1 §3 and p2 §5; FIN-01 p1 §3 Table 1.

### Q5. Does the Brennock maintenance contract need General Counsel co-approval? (chain; 3 documents)
**Expected:** No. CA-2 applies only to terms longer than 24 months; CON-2024-031 runs exactly 24 months. CA-2 is unchanged by the amendment.
Where: PRC-01 p1 control block and §2; FIN-01 p2 §4 Table 2; FIN-02 p1 §1.

### Q6. What is the restore time for a P2 fault on the Ardmoor test rigs? (single document)
**Expected:** 24 hours (response 4 hours), clock hours from the service desk log. The amendment from 1 October 2025 changes only the P1 restore time.
Where: PRC-01 p3 Appendix A; PRC-07 p1 §2.

### Q7. Access check (roles)
Give a test user only the IT role and ask Q1. Expected: the answer finds PO-10234 (USD 64,800, OT hardware, raised 18 August 2025) but says it cannot see the approval rules or the staff directory, and does not name an approver.

### Q8. Was the restore time met for incident INC-2025-024, and what credit applies? (version, calc; 3 documents)
**Expected:** No. INC-2025-024 (7 October 2025, TR-3, P1) was logged after 1 October 2025, so the amended P1 restore time of 6 hours applies; the rig was restored after 7 hours. Credit: 5% of the amended monthly fee of USD 19,800 = USD 990.
Where: IT-05 p1 control block and §3; PRC-07 p1 §2 Table 1 and p2 §4; PRC-01 p3 Appendix A (5%). Trap: the original 8 hours (met) and USD 18,500 fee (USD 925).

### Q9. Can Calderwick end the Brennock maintenance contract immediately because of missed restore times? (chain, count; 4 documents)
**Expected:** No. Immediate termination needs 3 or more missed P1 restore times in any 6 months. Brennock missed 2 (INC-2025-014 on 14 August and INC-2025-024 on 7 October 2025). INC-2025-021 was P2 and does not count. Clause 8 is unchanged by the amendment.
Where: PRC-01 p2 §8; IT-01 p1 §3; IT-05 p1 §3; IT-04 p1 control block; PRC-07 p1 §2; PRC-08 p2 §4 (says 1 as of 30 September, before INC-2025-024).

### Q10. What does Brennock Valve Supplies Ltd supply and who manages its contract? (lookalike, chain; 3 documents)
**Expected:** Gate valves for pump assembly at Hollins Cross under CON-2023-019 (VEN-041). Contract owner: Procurement Manager, Direct Materials, Marcus Ebner. It is not Brennock Valve Services Ltd (VEN-014, rig maintenance).
Where: PRC-03 p1 Table 1 and p2 §3; PRC-05 p1 §1-2 and p2 §6; HR-01 p2 §2 (E-1022).

### Q11. Which purchase order was split, and who should have approved it? (chain; 4 documents)
**Expected:** PO-10236 (USD 118,000) and PO-10237 (USD 74,500), both to Ardent Controls Ltd on 20 August 2025 for PRJ-11 engineering, total USD 192,500. That needs the CFO, Tobias Renwick (band C), and the COO, Adaeze Okafor (CA-3, capital above USD 100,000). PO-10237 was approved only by Marcus Ebner; the CFO ratified it on 8 October and the COO on 9 October 2025.
Where: FIN-09 p2 §3 Table 1 F1; FIN-08 p3 Table 1; FIN-02 p1 §3; FIN-01 p2 §4 Table 2 and §6.

### Q12. Who was the IT Service Manager in January 2025, and who is it from July 2025? (version; 3 documents)
**Expected:** Paolo Benedetti (E-1030) in the January 2025 directory; he left on 30 June 2025. Kwame Asante (E-1031) from July 2025.
Where: HR-02 p2 §2; HR-01 p2 §2; IT-06 p1 §2 Table 2 A1.

### Q13. Who must approve an OT hardware purchase order of USD 30,000 raised on 5 November 2025? (chain, version; 4 documents)
**Expected:** The Head of Procurement, Linnea Haugland (band B), and, under CA-1, the Head of IT. From 1 November 2025 that is the interim Head of IT, Yusuf Karimi, because Dev Malhotra leaves on 31 October 2025.
Where: FIN-02 p1 §3 and p2 §4; BRD-04 p2 §4 (Resolution 2025-12); IT-06 p2 §3; HR-01 p1 §2.

### Q14. What hotel cap applies to a Frankfurt trip starting 15 September 2025? (version; 2 documents)
**Expected:** USD 275 per night (major city, from 1 September 2025). Before then it was USD 240.
Where: HR-05 p1 §1 and §3 Table A; HR-04 p1 §4 and p2 Table 2.

### Q15. Who approves a business trip estimated at USD 6,500 after the September 2025 amendment? (version, unchanged rule; 2 documents)
**Expected:** The head of department (USD 2,001 to 10,000). The amendment did not change the approval limits.
Where: HR-04 p2 §6 Table 3; HR-05 p1 §1.

### Q16. Who owns the risks of the Fenwick Bay furnace relining project, and how are they rated? (chain; 3 documents)
**Expected:** R-09 (relining overruns the shutdown), High, owned by the Plant Manager, Fenwick Bay, Nadia Ferreira; and R-10 (emissions permit renewal), Medium, owned by the Sustainability Lead, Lucia Moretti.
Where: OPS-01 p1 Table 1 (PRJ-14); OPS-02 p1 Table 1; HR-01 p2 and p3 §2.

### Q17. Who owns the main risks of the Ardmoor rig control upgrade? (chain; 3 documents)
**Expected:** R-07 (single maintenance supplier), High, Procurement Manager, Plant Services, Ingrid Solvang; R-11 (cyber attack on OT networks), High, Information Security Officer, Yusuf Karimi.
Where: OPS-01 p1 Table 1 (PRJ-11); OPS-02 p1 Table 1; HR-01 p2 §2. Also OPS-03 p2 §6.

### Q18. What is the recovery time objective for the ERP, and was disaster recovery invoked for INC-2025-017? (chain; 2 documents)
**Expected:** RTO 8 hours (RPO 4 hours). The outage lasted 6 hours 5 minutes, within the RTO, so disaster recovery was not invoked; Quillon still missed its 4-hour contract restore target.
Where: IT-07 p1 §3 Table 2 and p2 §4; IT-03 p1 §3.

### Q19. How much was claimed from Quillon Software for the ERP outage, and by whom? (calc; 2 documents)
**Expected:** USD 420 (10% of the USD 4,200 monthly support fee), claimed by Dev Malhotra, Head of IT, on 15 September 2025.
Where: PRC-08 p2 §3 Table 2; IT-03 p2 §5 Table 2.

### Q20. Did Tarnfield Logistics owe a service credit for September 2025? (calc, trap; 2 documents)
**Expected:** No. On-time was 94.1%, less than one full percentage point below the 95% target; the credit is 3% per full point.
Where: PRC-06 p1 §4; PRC-08 p1 Table 1 and p2 Table 2.

### Q21. What unit price was paid for the PLC controllers on PO-10234, and under which contract? (calc, chain; 2 documents)
**Expected:** USD 32,400 each (2 controllers, USD 64,800), item AC-HPU-7 under framework agreement CON-2025-008 with Ardent Controls Ltd.
Where: FIN-08 p2 Table 1; PRC-04 p2 Schedule 1.

### Q22. Who was allowed to sign Amendment No. 1 to the Brennock maintenance contract? (calc, chain; 3 documents)
**Expected:** The Head of Procurement. Total contract value after the amendment is 13 months x USD 18,500 (September 2024 to September 2025) + 11 months x USD 19,800 (October 2025 to August 2026) = USD 458,300, within USD 50,001 to 500,000. Linnea Haugland signed it.
Where: LEG-03 p1 §2 Table 1; PRC-01 p1 §2 and §4; PRC-07 p1 §2 and p2 §5.

### Q23. What was test and calibration revenue in FY2025, and how much did it grow? (single document)
**Expected:** USD 11.8 million, up 16.8% from USD 10.1 million.
Where: FIN-05 p2 §3.1 Table 3.

### Q24. How did Q2 FY2026 revenue compare with budget, and what reduced Ardmoor test revenue? (chain; 1-2 documents)
**Expected:** USD 25.1 million against a budget of USD 24.9 million (+0.2). The TR-3 outage (INC-2025-014) and the TR-1 leak (INC-2025-021) cost about USD 0.12 million of test revenue, and a repeat test cost USD 41,000.
Where: FIN-04 p1 §1-2; OPS-05 p1 §1.

### Q25. Who wrote the FY2025 Health and Safety Annual Report, and who is the Health and Safety Manager now? (version; 3 documents)
**Expected:** Orla Fitzgerald, who left on 30 April 2025; Mei-Lin Zhou from 1 May 2025.
Where: OPS-09 p1 control block and p2 §7; HR-02 p2 §2 (E-1050); HR-01 p2 §2 (E-1054).

### Q26. May Amara Nwosu drive a forklift on 1 October 2025? (chain; 2 documents)
**Expected:** No. Her counterbalance forklift certificate expired on 2 September 2025 and is recorded as lapsed; an operator with a lapsed certificate may not use the equipment until the renewal is recorded.
Where: HR-06 p1 §2 Table 1 (E-2031); HR-03 p4 §9. Note: operators are not in the staff directory.

### Q27. Which compliance obligation is overdue, and why? (single document)
**Expected:** C-08, the annual General Counsel review of High-risk supplier Brennock Valve Services Ltd (VEN-014), due 31 August 2025, delayed by the contract renegotiation; to be completed by 31 October 2025.
Where: LEG-01 p1 §2 Table 1 and p2 §3.

### Q28. Which resolution approved the furnace relining budget, and who could sign the relining contract? (chain; 2 documents)
**Expected:** Resolution 2025-13 of 18 September 2025 approved PRJ-14 with USD 1,150,000; the Board authorised the CFO (Tobias Renwick) to sign contract CON-2025-019 with Kelvar Furnace Services Ltd.
Where: BRD-04 p2 §5; LEG-03 p1 §3; OPS-04 p1 §2.

### Q29. What is the P1 response time in the Tarnfield haulage contract? (negative)
**Expected:** The Tarnfield contract has no P1 or response times; it measures on-time loads against a 95% monthly target. P1 response times belong to the Brennock rig maintenance contract.
Where: PRC-06 p1 §4.

### Q30. Who approved purchase order PO-10281? (negative)
**Expected:** The documents do not record its approver. PO-10281 (USD 14,600, spare motor, raised 9 October 2025) appears only in incident report INC-2025-024; the purchase order log covers July to September 2025 only. Under FIN-AAM-02 it would need the Head of Procurement (band B), but no approval is recorded.
Where: IT-05 p2 §5 Table 2; FIN-08 p1 §1.

### Q31. Access check 2 (roles)
Give a test user only the Procurement role and ask Q2. Expected: USD 925 can be answered from the Vendor Performance Review (PRC-08) and the contract (PRC-01) alone; the answer must not cite IT or Finance documents.
