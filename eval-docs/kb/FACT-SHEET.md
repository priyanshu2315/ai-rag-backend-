# Knowledge-base fact sheet (synthetic test data)

Ground truth for the synthetic knowledge base. Every document in `source/` must agree with this file, and the answer key is derived from it. The company, people, vendors and codes are invented for testing.

## Company

- Name: Calderwick Pump Systems Ltd ("Calderwick"), industrial pump maker.
- Currency in all documents: USD. Fiscal year: 1 April to 31 March (FY2026 = 1 April 2025 to 31 March 2026).
- Sites: Head Office (at Hollins Cross); Plant P1 Hollins Cross (assembly); Plant P2 Ardmoor (test and calibration); Plant P3 Fenwick Bay (castings).
- Categories (one role each): HR, Finance, Procurement, Operations, IT, Board & Legal.

## People (staff directory HR-DIR-2025-07, valid from 1 July 2025)

| ID | Name | Role | Department | Location | Reports to (role) |
|---|---|---|---|---|---|
| E-1001 | Miriam Achterberg | Chief Executive Officer | Executive | Head Office | Board of Directors |
| E-1002 | Tobias Renwick | Chief Financial Officer | Finance | Head Office | Chief Executive Officer |
| E-1003 | Adaeze Okafor | Chief Operating Officer | Operations | Head Office | Chief Executive Officer |
| E-1004 | Linnea Haugland | Head of Procurement | Procurement | Head Office | Chief Financial Officer |
| E-1005 | Dev Malhotra | Head of IT | IT | Head Office | Chief Operating Officer |
| E-1006 | Saoirse Kinsella | Head of People | HR | Head Office | Chief Executive Officer |
| E-1007 | Bastian Kroll | General Counsel | Legal | Head Office | Chief Executive Officer |
| E-1011 | Priyamvada Rao | Financial Controller | Finance | Head Office | Chief Financial Officer |
| E-1012 | Owen Tremayne | Accounts Payable Lead | Finance | Head Office | Financial Controller |
| E-1021 | Ingrid Solvang | Procurement Manager, Plant Services | Procurement | Ardmoor (P2) | Head of Procurement |
| E-1022 | Marcus Ebner | Procurement Manager, Direct Materials | Procurement | Fenwick Bay (P3) | Head of Procurement |
| E-1023 | Talia Brennan | Category Buyer, MRO | Procurement | Hollins Cross (P1) | Procurement Manager, Plant Services |
| E-1024 | Ingrid Solberg | Category Buyer, Packaging | Procurement | Fenwick Bay (P3) | Procurement Manager, Direct Materials |
| E-1031 | Kwame Asante | IT Service Manager | IT | Head Office | Head of IT |
| E-1032 | Elif Demir | OT Systems Engineer | IT | Ardmoor (P2) | IT Service Manager |
| E-1033 | Henrik Lindqvist | Service Desk Lead | IT | Head Office | IT Service Manager |
| E-1034 | Yusuf Karimi | Information Security Officer | IT | Head Office | Head of IT |
| E-1041 | Clementine Dufresne | Plant Manager, Hollins Cross (P1) | Operations | Hollins Cross (P1) | Chief Operating Officer |
| E-1042 | Ragnar Holt | Plant Manager, Ardmoor (P2) | Operations | Ardmoor (P2) | Chief Operating Officer |
| E-1043 | Nadia Ferreira | Plant Manager, Fenwick Bay (P3) | Operations | Fenwick Bay (P3) | Chief Operating Officer |
| E-1051 | Jonah Whitlock | Test Rig Supervisor | Operations | Ardmoor (P2) | Plant Manager, Ardmoor (P2) |
| E-1052 | Sunniva Berg | Maintenance Lead, Ardmoor | Operations | Ardmoor (P2) | Plant Manager, Ardmoor (P2) |
| E-1053 | Callum Reid | Quality Manager | Operations | Fenwick Bay (P3) | Plant Manager, Fenwick Bay (P3) |
| E-1054 | Mei-Lin Zhou | Health and Safety Manager | Operations | Hollins Cross (P1) | Chief Operating Officer |
| E-1061 | Anouk Visser | HR Business Partner, Plants | HR | Ardmoor (P2) | Head of People |
| E-1062 | Felipe Arriaga | Payroll Manager | HR | Head Office | Head of People |
| E-1071 | Greta Novak | Contracts Counsel | Legal | Head Office | General Counsel |
| E-1081 | Ishaan Kapoor | Project Manager, Ardmoor Rig Upgrade | Operations | Ardmoor (P2) | Chief Operating Officer |
| E-1082 | Lucia Moretti | Sustainability Lead | Executive | Head Office | Chief Executive Officer |
| E-1091 | Torsten Wahl | Executive Assistant to the CEO | Executive | Head Office | Chief Executive Officer |

Acting appointment (directory section 3): Linnea Haugland (Head of Procurement) on leave 4 to 22 August 2025 inclusive; Marcus Ebner acts as Head of Procurement with full approval authority for that period.

Traps: Ingrid Solvang vs Ingrid Solberg (different people, different roles).

## Approval authority matrix

Version 1, FIN-AAM-01, effective 1 April 2024, Board Resolution 2024-03 (14 March 2024).

| Band | PO value (USD, excl. tax) | Approver |
|---|---|---|
| A | up to 10,000 | Budget-holding department head |
| B | 10,001 to 50,000 | Head of Procurement |
| C | 50,001 to 250,000 | Chief Financial Officer |
| D | 250,001 to 1,000,000 | Chief Executive Officer |
| E | above 1,000,000 | Board of Directors (by resolution) |

Co-approval rules (v1): CA-1 IT and OT hardware or software above USD 25,000: Head of IT. CA-2 contract term longer than 24 months: General Counsel. CA-3 capital projects above USD 100,000: Chief Operating Officer.
Emergency rule (v1 section 5): a Plant Manager may approve emergency repair purchases up to USD 15,000; the normal approver ratifies within 5 working days.

Version 2, FIN-AAM-02 (Amendment No. 1), effective 1 July 2025, Board Resolution 2025-07 (19 June 2025). Replaces Table 1 and rule CA-1 of FIN-AAM-01 only; everything else in FIN-AAM-01 stays in force. The band is set by the date the PO is raised.

| Band | PO value (USD, excl. tax) | Approver |
|---|---|---|
| A | up to 10,000 | Budget-holding department head |
| B | 10,001 to 75,000 | Head of Procurement |
| C | 75,001 to 200,000 | Chief Financial Officer |
| D | 200,001 to 750,000 | Chief Executive Officer |
| E | above 750,000 | Board of Directors (by resolution) |

CA-1 (v2): IT and OT hardware or software above USD 20,000: Head of IT.

## Vendor contract

- Contract CON-2024-031, Maintenance Services Agreement, Calderwick and Brennock Valve Services Ltd, vendor ID VEN-014.
- Term 1 September 2024 to 31 August 2026 (exactly 24 months, so CA-2 does not apply).
- Scope: preventive and corrective maintenance of hydraulic test rigs TR-1 to TR-4 at Ardmoor (P2). Parts are not included; Calderwick buys parts on separate POs.
- Monthly fee USD 18,500, invoiced monthly in arrears.
- Calderwick contract owner: Procurement Manager, Plant Services. Technical contact: Maintenance Lead, Ardmoor. Vendor account manager: Declan Murtagh. Vendor operations director: Rhiannon Pryce.
- Clause 6: service levels in Appendix A. Clause 7: contract owner claims service credits within 30 days after month end; deducted from the next invoice. Clause 8: 90 days notice; immediate termination after 3 or more missed P1 restore times in any 6 months.
- Appendix A: P1 rig out of service: response 2 h, restore 8 h, credit 5% of monthly fee. P2 rig degraded: 4 h, 24 h, 2%. P3 minor fault: next business day, 5 business days, 0.5%. Clock hours from the time the Calderwick service desk logs the call. Missed response time adds 1% of the monthly fee. Credits capped at 15% of the monthly fee per month.

## Incident

- INC-2025-014, 14 August 2025, Ardmoor (P2), test rig TR-3, priority P1, vendor Brennock Valve Services Ltd (VEN-014) under CON-2024-031. Incident owner: IT Service Manager.
- 06:40 rig stopped; 06:55 service desk logged P1 and called vendor; 08:30 vendor engineer on site (response 1 h 35 min, within 2 h); 11:10 fault traced to failed PLC controller on the hydraulic power unit; 18:15 spare controller from TR-1 fitted, TR-3 restored (restore 11 h 20 min, over 8 h).
- Follow-up purchase PO-10234: two PLC controllers (replacement and spare), OT hardware, supplier Ardent Controls Ltd (VEN-052), raised 18 August 2025, USD 64,800 excl. tax.
- Closed 29 August 2025. Prepared by IT Service Manager, reviewed by Head of IT.

## Added for documents 6-50 (9 November 2025 build)

### People over time
- January 2025 directory (HR-DIR-2025-01) differs from July: IT Service Manager Paolo Benedetti (E-1030, left 30 June 2025, account disabled late on 8 July 2025); Health and Safety Manager Orla Fitzgerald (E-1050, left 30 April 2025); Talia Brennan, Kwame Asante, Mei-Lin Zhou and Ishaan Kapoor not yet employed; Category Buyer, MRO vacant; acting Financial Controller Owen Tremayne 6-24 January 2025.
- Dev Malhotra (Head of IT) resigned, last day 31 October 2025; Yusuf Karimi interim Head of IT from 1 November 2025 with full authority including CA-1 (Resolution 2025-12).
- Board: Helena Marsh (chair, independent), Miriam Achterberg (CEO), Tobias Renwick (CFO), Rafael Okonjo (independent, Audit Committee chair), Wen Sorensen (non-executive); company secretary Bastian Kroll.
- Operators (not in the directory): E-2014 Pavel Novotny, E-2031 Amara Nwosu (forklift certificate lapsed 2 September 2025), E-2047 Lewis Carrow, E-2052 Hana Sato, E-2058 Tomasz Wilk (lapsed), E-2063 Rosa Delgado, E-2071 Ewan McTavish.

### Board resolutions
2024-03 FIN-AAM-01 (14 Mar 2024); 2024-04 FY2025 budget; 2024-11 Procurement Policy v4 from 1 Jan 2025 (12 Dec 2024); 2024-12 Fairholm Assurance LLP internal auditor from 1 Jan 2025; 2025-03 FY2026 budget (13 Mar 2025); 2025-07 FIN-AAM-02; 2025-08 PRJ-11 USD 480,000 (19 Jun 2025); 2025-11 Brennock warning, P1 restore at most 6 h from 1 Oct 2025, second supplier by 31 Dec 2025; 2025-12 interim Head of IT; 2025-13 PRJ-14 USD 1,150,000 and Kelvar contract, CFO to sign (18 Sep 2025).

### Vendors and contracts
VEN-014 Brennock Valve Services Ltd (CON-2024-031, High); VEN-018 Ardent Control Systems GmbH (inactive, unrelated); VEN-033 Hartwell Steel Castings Ltd (CON-2022-007); VEN-041 Brennock Valve Supplies Ltd (CON-2023-019, gate valves DN100 940 / DN150 1,315 / DN200 1,980, unrelated to VEN-014); VEN-052 Ardent Controls Ltd (CON-2025-008, 1 Feb 2025-31 Jan 2028, AC-HPU-7 32,400, AC-HMI-12 7,300, AC-FW-R 6,500 per rig, engineering 1,450 per day); VEN-061 Tarnfield Logistics Ltd (CON-2025-014, 95% on-time, 3% credit per full point below); VEN-077 Quillon Software Ltd (CON-2023-044, ERP restore 4 h, 10% of USD 4,200 monthly support fee); VEN-089 Kelvar Furnace Services Ltd (CON-2025-019); VEN-095 Mercer Safety Supplies; VEN-102 Fairholm Assurance LLP; VEN-108 Corvia Travel Ltd; VEN-113 Clearline Hotline Ltd.
Amendment CON-2024-031-A1 (signed 26 Sep 2025 by Linnea Haugland and Rhiannon Pryce, effective 1 Oct 2025): adds TR-5, fee USD 19,800, P1 restore 6 h, on-call engineer 07:00-22:00; incidents logged before 1 Oct keep the old terms.
Signing authority LEG-SIGN-01 (from 1 Jan 2025): up to 50,000 procurement manager; 50,001-500,000 Head of Procurement; 500,001-2,000,000 CFO; above 2,000,000 CEO after Board resolution; terms longer than 24 months also General Counsel.

### Incidents
- INC-2025-017: 26 Aug 2025, Ledgerline ERP, IT P1, Quillon, 08:05-14:10 (6 h 05), credit USD 420 claimed by Dev Malhotra 15 Sep 2025, PO-10241 USD 8,700; DR RTO 8 h not exceeded.
- INC-2025-021: 9 Sep 2025, TR-1 hydraulic leak, P2, Brennock; logged 09:10, on site 15:40 (6 h 30, missed 4 h), restored 11 Sep 10:00 (48 h 50, missed 24 h); credit 3% of 18,500 = USD 555 claimed 3 Oct 2025; parts PO-10252 USD 23,900.
- INC-2025-024: 7 Oct 2025, TR-3 pump motor, P1, Brennock; logged 13:20, on site 14:50 (1 h 30), restored 20:20 (7 h, misses amended 6 h); credit 5% of 19,800 = USD 990 (not yet claimed); spare motor PO-10281 USD 14,600 raised 9 Oct 2025 (approver not recorded anywhere).

### Purchase orders (FIN-08, July-September 2025, total USD 1,447,600)
PO-10189 (27 Jun, 62,000, FIN-AAM-01, CFO), PO-10198, PO-10203 (40 DN150 valves 52,600), PO-10207 (3 HMI 21,900 + CA-1), PO-10211 (96,000 CFO + CA-1), PO-10215, PO-10219 (9,800 Ragnar Holt), PO-10222/10226 (Marcus Ebner acting), PO-10229 (emergency 12,400, ratified 19 Aug), PO-10234, PO-10236 (118,000 CFO + COO) and PO-10237 (74,500 Marcus Ebner only: split order, audit finding F1), PO-10241, PO-10245, PO-10249 (6,300 Mei-Lin Zhou), PO-10252, PO-10256 (212,000 CEO), PO-10259 (345,000 CEO + COO, PRJ-14 deposit), PO-10263 (3 firmware licences 19,500, just below CA-1).

### Projects and risks
PRJ-11 Ardmoor rig control upgrade 480,000 (Ishaan Kapoor; risks R-07, R-11; tender TE-2025-03 won by Ardent 84.8 points at 192,500, award approved by CFO and COO 5 Aug 2025); PRJ-12 Hollins Cross line 3 automation 260,000 (Clementine Dufresne; R-03); PRJ-14 Fenwick Bay furnace relining 1,150,000 (Nadia Ferreira; R-09, R-10; shutdown 3-24 Nov 2025); PRJ-15 ERP upgrade 210,000 (Head of IT; R-12); PRJ-16 solar canopy 95,000 (Lucia Moretti; R-14). Risk owners are roles; R-07 Procurement Manager, Plant Services; R-11 Information Security Officer; R-08 closed 25 Aug 2025.

### Finance
FY2025: revenue 92.4 m (pumps 66.1, test services 11.8, parts 14.5), EBITDA 13.1 m, net profit 6.8 m, capex 5.2 m, headcount 612. FY2026 budget: revenue 98.5 m, EBITDA 14.2 m, capex 7.4 m. Q1 FY2026: revenue 23.6 m (budget 24.0); Q2: 25.1 m (budget 24.9); H1 48.7 m.

### Travel and expenses
HR-TEP-01 (1 Apr 2024): hotels 180 / 240 major cities, allowance 55 / 25, premium economy above 6 h, claims within 30 days, approvals line manager up to 2,000, head of department 2,001-10,000, CFO above. HR-TEP-02 (trips from 1 Sep 2025): hotels 210 / 275, allowance 60 / 30, premium economy above 8 h, claims within 45 days; approvals and mileage (0.38 per km) unchanged.

## Derived answers (pilot)

- Approver of PO-10234: raised 18 August 2025, so FIN-AAM-02 applies; USD 64,800 is band B, Head of Procurement; on 18 August 2025 Linnea Haugland was on leave and Marcus Ebner was acting Head of Procurement. OT hardware above USD 20,000, so co-approval by Head of IT, Dev Malhotra. (Under FIN-AAM-01 it would have been the CFO, Tobias Renwick, plus the Head of IT.)
- Service credit for INC-2025-014: restore 11 h 20 min misses the P1 restore time of 8 h, so 5% of USD 18,500 = USD 925. Response 1 h 35 min met the 2 h target, so no extra 1%.
- Contract owner for VEN-014: Procurement Manager, Plant Services = Ingrid Solvang, who reports to the Head of Procurement (Linnea Haugland).
