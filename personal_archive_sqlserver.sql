-- Personal archive schema + data, for Microsoft SQL Server 2022
-- Run inside the database you want these tables created in.
-- (Optional) create a dedicated database first by uncommenting the two lines below:
-- CREATE DATABASE PersonalArchive;
-- GO
-- USE PersonalArchive;
-- GO

CREATE TABLE files (
    id INT IDENTITY(1,1) PRIMARY KEY,
    filename NVARCHAR(255) NOT NULL,
    file_type NVARCHAR(20) NOT NULL,
    category NVARCHAR(50) NOT NULL,
    folder NVARCHAR(255) NOT NULL,
    size_kb INT NOT NULL,
    date_created DATE NOT NULL,
    date_modified DATE NOT NULL,
    last_opened DATE NULL,
    is_starred BIT NOT NULL DEFAULT 0,
    description NVARCHAR(500) NULL
);
GO

CREATE TABLE tags (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(50) NOT NULL UNIQUE
);
GO

CREATE TABLE file_tags (
    file_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (file_id, tag_id),
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);
GO

CREATE INDEX idx_files_category ON files(category);
CREATE INDEX idx_files_type ON files(file_type);
GO

SET IDENTITY_INSERT files ON;
INSERT INTO files (id, filename, file_type, category, folder, size_kb, date_created, date_modified, last_opened, is_starred, description) VALUES
(1, N'2023_Tax_Return_Federal.pdf', N'PDF', N'Tax', N'/Documents/Taxes/2023', 516, '2023-01-13', '2023-07-21', NULL, 0, N'Completed annual tax return submission'),
(2, N'2024_Tax_Return_Federal.pdf', N'PDF', N'Tax', N'/Documents/Taxes/2024', 1788, '2024-01-17', '2024-01-24', NULL, 0, N'Completed annual tax return submission'),
(3, N'2022_W2_Employer.pdf', N'PDF', N'Tax', N'/Documents/Taxes/2022', 1778, '2022-04-23', '2022-08-15', '2022-08-28', 0, N'Annual wage and tax statement from employer'),
(4, N'2023_Provisional_Tax_Receipt.pdf', N'PDF', N'Tax', N'/Documents/Taxes/2023', 1791, '2023-06-24', '2023-09-03', NULL, 0, N'Proof of provisional tax payment'),
(5, N'Tax_Deduction_Summary_2024.xlsx', N'XLSX', N'Tax', N'/Documents/Taxes/2024', 117, '2024-07-02', '2024-09-28', '2024-11-11', 0, N'Spreadsheet tracking deductible expenses'),
(6, N'Invoice_0231_WebDesign_ClientA.pdf', N'PDF', N'Invoice', N'/Documents/Invoices/2024', 1260, '2024-11-17', '2025-04-24', '2025-10-26', 0, N'Invoice issued for website design work'),
(7, N'Invoice_0244_LogoDesign_ClientB.pdf', N'PDF', N'Invoice', N'/Documents/Invoices/2024', 1245, '2024-02-10', '2024-04-09', '2025-05-03', 0, N'Invoice issued for logo design project'),
(8, N'Invoice_0198_Consulting_Jan2024.pdf', N'PDF', N'Invoice', N'/Documents/Invoices/2024', 1576, '2024-01-12', '2024-03-05', '2026-02-21', 0, N'Invoice for consulting hours'),
(9, N'Invoice_0257_Tutoring_Mar2025.pdf', N'PDF', N'Invoice', N'/Documents/Invoices/2025', 760, '2025-03-18', '2025-09-20', NULL, 0, N'Invoice for private tutoring sessions'),
(10, N'Invoice_0212_Freelance_Dec2023.pdf', N'PDF', N'Invoice', N'/Documents/Invoices/2023', 959, '2023-12-22', '2024-03-14', '2026-05-17', 1, N'Invoice for freelance development work'),
(11, N'Apartment_Lease_Agreement_2025.pdf', N'PDF', N'Contract', N'/Documents/Contracts', 1348, '2025-04-19', '2025-10-03', '2026-08-28', 0, N'Signed residential lease agreement'),
(12, N'Freelance_Contract_StudioNine.docx', N'DOCX', N'Contract', N'/Documents/Contracts', 312, '2023-12-13', '2024-06-21', '2026-02-08', 0, N'Service agreement with design studio'),
(13, N'NDA_TechCorp_2025.pdf', N'PDF', N'Contract', N'/Documents/Contracts', 626, '2025-09-18', '2026-01-22', NULL, 1, N'Non-disclosure agreement for contract work'),
(14, N'Gym_Membership_Contract.pdf', N'PDF', N'Contract', N'/Documents/Contracts', 715, '2025-09-26', '2026-02-25', NULL, 0, N'Annual gym membership terms'),
(15, N'Receipt_Laptop_OnlineOrder.pdf', N'PDF', N'Receipt', N'/Documents/Receipts/2025', 1152, '2025-11-25', '2026-02-20', NULL, 0, N'Purchase receipt for work laptop'),
(16, N'Receipt_Furniture_Store.jpg', N'JPG', N'Receipt', N'/Documents/Receipts/2024', 4900, '2024-04-01', '2024-08-08', '2026-05-10', 0, N'Photographed receipt for desk and chair'),
(17, N'Receipt_Textbooks_Campus_Store.pdf', N'PDF', N'Receipt', N'/Documents/Receipts/2025', 686, '2025-07-11', '2026-01-22', NULL, 0, N'Receipt for semester textbooks'),
(18, N'Receipt_Flight_Domestic_Trip.pdf', N'PDF', N'Receipt', N'/Documents/Receipts/2024', 1546, '2024-06-06', '2024-08-06', NULL, 0, N'E-ticket and payment receipt'),
(19, N'Receipt_Conference_Ticket_DevConf.pdf', N'PDF', N'Receipt', N'/Documents/Receipts/2026', 575, '2026-02-02', '2026-07-20', '2026-08-24', 0, N'Registration receipt for developer conference'),
(20, N'Passport_Scan.pdf', N'PDF', N'Identification', N'/Documents/ID', 927, '2023-04-04', '2023-10-03', NULL, 0, N'Scanned copy of passport photo page'),
(21, N'ID_Card_Scan_Front.png', N'PNG', N'Identification', N'/Documents/ID', 4839, '2026-01-24', '2026-02-23', NULL, 1, N'Front side scan of national ID card'),
(22, N'Drivers_License_Scan.jpg', N'JPG', N'Identification', N'/Documents/ID', 5337, '2023-08-01', '2023-12-29', NULL, 1, N'Scanned copy of driver''s license'),
(23, N'Car_Insurance_Policy_2025.pdf', N'PDF', N'Insurance', N'/Documents/Insurance', 188, '2025-06-19', '2025-07-07', '2025-11-26', 0, N'Annual vehicle insurance policy document'),
(24, N'Health_Insurance_Membership_Card.jpg', N'JPG', N'Insurance', N'/Documents/Insurance', 1883, '2026-04-21', '2026-06-22', '2026-08-13', 0, N'Photo of medical aid membership card'),
(25, N'Home_Contents_Insurance_2024.pdf', N'PDF', N'Insurance', N'/Documents/Insurance', 1825, '2024-06-30', '2024-10-16', '2024-12-10', 0, N'Home contents insurance policy'),
(26, N'Insurance_Claim_Form_Laptop.pdf', N'PDF', N'Insurance', N'/Documents/Insurance', 507, '2023-10-16', '2023-12-04', NULL, 0, N'Claim form for damaged laptop'),
(27, N'Vaccination_Record.pdf', N'PDF', N'Medical', N'/Documents/Medical', 1083, '2021-11-05', '2022-02-26', '2025-03-29', 1, N'Personal immunization history'),
(28, N'Dentist_Report_2024.pdf', N'PDF', N'Medical', N'/Documents/Medical', 442, '2024-05-01', '2024-06-12', '2025-10-17', 0, N'Report from annual dental checkup'),
(29, N'Optometrist_Prescription.jpg', N'JPG', N'Medical', N'/Documents/Medical', 3904, '2021-01-09', '2021-04-18', NULL, 0, N'Photo of eyewear prescription'),
(30, N'Medical_Aid_Statement_2025.pdf', N'PDF', N'Medical', N'/Documents/Medical', 2053, '2025-03-21', '2025-05-08', NULL, 0, N'Annual medical aid claims statement'),
(31, N'Diploma_Certificate_Scan.pdf', N'PDF', N'Education', N'/Documents/Education', 1344, '2021-08-23', '2021-09-04', '2024-06-29', 0, N'Scanned copy of diploma certificate'),
(32, N'Academic_Transcript_2024.pdf', N'PDF', N'Education', N'/Documents/Education', 2140, '2024-02-11', '2024-03-29', NULL, 1, N'Official academic transcript'),
(33, N'SQL_Fundamentals_Certificate.pdf', N'PDF', N'Education', N'/Documents/Education', 222, '2021-12-02', '2022-03-19', '2025-05-19', 0, N'Completion certificate for online SQL course'),
(34, N'NQF6_Enrollment_Letter.pdf', N'PDF', N'Education', N'/Documents/Education', 1288, '2026-02-16', '2026-05-07', '2026-05-16', 1, N'Enrollment confirmation letter'),
(35, N'Resume_2026.docx', N'DOCX', N'Work', N'/Documents/Work', 76, '2026-01-19', '2026-06-05', NULL, 0, N'Current version of resume'),
(36, N'Cover_Letter_TechStart.docx', N'DOCX', N'Work', N'/Documents/Work', 359, '2021-02-02', '2021-07-22', '2023-03-27', 0, N'Cover letter drafted for job application'),
(37, N'Offer_Letter_DevRole.pdf', N'PDF', N'Work', N'/Documents/Work', 610, '2023-12-20', '2024-01-18', '2026-02-16', 0, N'Signed offer letter for developer role'),
(38, N'Performance_Review_2025.pdf', N'PDF', N'Work', N'/Documents/Work', 1464, '2025-04-15', '2025-10-07', '2026-02-19', 0, N'Annual performance review summary'),
(39, N'Payslip_July2026.pdf', N'PDF', N'Work', N'/Documents/Work/Payslips', 1794, '2026-07-27', '2026-08-13', NULL, 0, N'Monthly payslip document'),
(40, N'Journal_Entries_2024.docx', N'DOCX', N'Personal', N'/Documents/Personal', 159, '2024-03-23', '2024-09-28', '2025-12-09', 0, N'Personal journal writing'),
(41, N'Recipe_Collection_Notes.txt', N'TXT', N'Personal', N'/Documents/Personal', 11, '2021-05-28', '2021-08-30', '2022-06-29', 0, N'Collected recipe notes'),
(42, N'Reading_List_2025.xlsx', N'XLSX', N'Personal', N'/Documents/Personal', 391, '2025-01-21', '2025-04-22', NULL, 0, N'Tracked list of books read and to-read'),
(43, N'Budget_Planner_Personal.xlsx', N'XLSX', N'Personal', N'/Documents/Personal', 591, '2025-07-23', '2025-12-28', '2026-08-21', 0, N'Personal monthly budget spreadsheet'),
(44, N'Vacation_Photos_2024.jpg', N'JPG', N'Photo', N'/Photos/Vacations/2024', 4172, '2024-12-08', '2025-06-14', '2025-10-28', 1, N'Photos from a summer trip'),
(45, N'Graduation_Ceremony_2025.jpg', N'JPG', N'Photo', N'/Photos/Milestones', 4655, '2025-04-24', '2025-06-14', '2026-02-04', 0, N'Photos from graduation ceremony'),
(46, N'Family_Gathering_Dec2023.jpg', N'JPG', N'Photo', N'/Photos/Family', 4064, '2023-12-11', '2024-02-20', '2026-04-21', 0, N'Photos from a family get-together'),
(47, N'Hiking_Trip_Photos.jpg', N'JPG', N'Photo', N'/Photos/Outdoors', 5192, '2024-09-18', '2024-09-25', NULL, 0, N'Photos from a weekend hike'),
(48, N'Birthday_Celebration_2025.jpg', N'JPG', N'Photo', N'/Photos/Milestones', 2974, '2025-01-20', '2025-02-16', '2026-02-04', 0, N'Photos from a birthday celebration'),
(49, N'Laptop_Warranty_Card.pdf', N'PDF', N'Warranty', N'/Documents/Warranties', 2154, '2022-04-19', '2022-07-26', '2023-08-19', 0, N'Manufacturer warranty registration'),
(50, N'Fridge_Warranty_2023.pdf', N'PDF', N'Warranty', N'/Documents/Warranties', 867, '2023-07-06', '2023-10-24', NULL, 0, N'Appliance warranty document'),
(51, N'Phone_Warranty_Registration.pdf', N'PDF', N'Warranty', N'/Documents/Warranties', 570, '2024-05-15', '2024-09-21', NULL, 0, N'Warranty registration for phone');
SET IDENTITY_INSERT files OFF;
GO

SET IDENTITY_INSERT tags ON;
INSERT INTO tags (id, name) VALUES
(1, N'urgent'),
(2, N'important'),
(3, N'archived'),
(4, N'shared'),
(5, N'expired'),
(6, N'renew-soon'),
(7, N'signed'),
(8, N'draft'),
(9, N'confidential'),
(10, N'favorite');
SET IDENTITY_INSERT tags OFF;
GO

INSERT INTO file_tags (file_id, tag_id) VALUES
(1, 1),
(1, 2),
(2, 2),
(4, 2),
(5, 3),
(6, 1),
(6, 4),
(7, 4),
(8, 4),
(9, 1),
(10, 1),
(10, 2),
(11, 7),
(14, 2),
(14, 4),
(14, 7),
(15, 2),
(16, 3),
(17, 1),
(17, 2),
(17, 4),
(18, 1),
(18, 2),
(18, 3),
(19, 3),
(20, 9),
(22, 9),
(25, 1),
(25, 2),
(25, 6),
(26, 6),
(27, 1),
(27, 9),
(28, 9),
(29, 9),
(30, 9),
(31, 2),
(32, 1),
(32, 2),
(33, 1),
(33, 2),
(33, 3),
(34, 2),
(35, 1),
(35, 2),
(35, 5),
(37, 9),
(38, 8),
(43, 2),
(43, 4),
(44, 4),
(44, 10),
(45, 1),
(45, 4),
(46, 10),
(48, 10),
(49, 1),
(49, 6),
(50, 6),
(51, 6);
GO
