// src/templates/email/welcome-school.jsx
// Used for: School onboarding after super admin creates school account
// Props: { schoolName, adminName, adminEmail, tempPassword, dashboardUrl, planName, planExpiry, cardCount }

import {
    Html, Head, Body, Container, Section,
    Text, Heading, Hr, Link, Preview, Font, Row, Column,
} from '@react-email/components';

const c = {
    navy: '#05112b',
    navy2: '#0d2554',
    red: '#c0392b',
    white: '#ffffff',
    bg: '#eef0f5',
    muted: '#8a8fa8',
    ink: '#3d4259',
    rule: '#eceef5',
    subtle: '#f6f7fb',
};

const s = {
    body: { backgroundColor: c.bg, fontFamily: "'Inter', Helvetica, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '48px 16px' },
    metaBar: { maxWidth: '640px', margin: '0 auto 14px', padding: '0 4px' },
    metaText: { fontSize: '11px', color: '#8a8fa8', letterSpacing: '0.5px' },
    card: { maxWidth: '640px', margin: '0 auto', backgroundColor: c.white, borderRadius: '4px', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.08)' },
    headerStrip: { height: '4px', background: 'linear-gradient(90deg, #c0392b 0%, #e74c3c 40%, #c0392b 100%)' },
    headerInner: { backgroundColor: c.navy, padding: '40px 52px 44px' },
    brandShield: { display: 'inline-block', width: '42px', height: '42px', backgroundColor: c.red, borderRadius: '6px', textAlign: 'center', lineHeight: '42px', fontSize: '20px', verticalAlign: 'middle' },
    brandName: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: '20px', fontWeight: '600', color: c.white, letterSpacing: '0.5px', display: 'inline-block', verticalAlign: 'middle', marginLeft: '12px' },
    brandTagline: { fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '2.5px', textTransform: 'uppercase', display: 'block', marginTop: '2px' },
    statusBadge: { display: 'inline-block', border: '1px solid rgba(192,57,43,0.5)', backgroundColor: 'rgba(192,57,43,0.08)', padding: '5px 14px', borderRadius: '2px', marginBottom: '20px', marginTop: '28px' },
    statusText: { fontSize: '10px', fontWeight: '600', letterSpacing: '2px', textTransform: 'uppercase', color: '#e74c3c', margin: 0 },
    headerTitle: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: '30px', fontWeight: '500', color: c.white, lineHeight: '1.25', marginBottom: '14px' },
    headerSub: { fontSize: '13.5px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.65', borderLeft: '2px solid rgba(192,57,43,0.5)', paddingLeft: '14px', marginTop: '20px', maxWidth: '420px' },
    bodySection: { padding: '44px 52px', backgroundColor: c.white },
    salutation: { fontSize: '14.5px', color: c.ink, lineHeight: '1.75', marginBottom: '28px', paddingBottom: '28px', borderBottom: `1px solid ${c.rule}` },
    sectionLabelWrap: { marginBottom: '16px', marginTop: '28px' },
    sectionLabel: { fontSize: '10px', fontWeight: '600', letterSpacing: '2.5px', textTransform: 'uppercase', color: c.muted, borderLeft: `3px solid ${c.red}`, paddingLeft: '10px', display: 'inline-block' },
    credTable: { width: '100%', border: `1px solid #e4e7f2`, borderRadius: '4px', overflow: 'hidden', marginBottom: '24px' },
    credHeaderBg: { backgroundColor: c.navy, padding: '10px 20px' },
    credHeaderText: { fontSize: '9.5px', fontWeight: '600', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0 },
    credRow: { padding: '14px 20px', borderBottom: `1px solid ${c.rule}`, backgroundColor: c.white },
    credKey: { fontSize: '13px', color: c.muted, fontWeight: '500' },
    credVal: { fontSize: '14px', color: c.navy, fontWeight: '600', marginBottom: '2px' },
    credNote: { fontSize: '11.5px', color: c.muted },
    credValPass: { fontSize: '14px', color: c.navy, fontWeight: '600', fontFamily: 'monospace', backgroundColor: '#f0f4ff', padding: '2px 8px', borderRadius: '4px' },
    credValLink: { fontSize: '14px', color: '#1a56db', fontWeight: '600', textDecoration: 'none' },
    noticeBox: { backgroundColor: '#fffbf0', border: '1px solid #f5d87a', borderRadius: '6px', padding: '14px 18px', marginBottom: '28px', display: 'flex', gap: '12px' },
    noticeText: { fontSize: '13.5px', color: '#5c4a00', lineHeight: '1.6', margin: 0 },
    stepItem: { marginBottom: '20px', display: 'flex', gap: '16px', alignItems: 'flex-start' },
    stepNum: { width: '28px', height: '28px', backgroundColor: c.navy, borderRadius: '50%', textAlign: 'center', lineHeight: '28px', color: c.white, fontSize: '11px', fontWeight: '700', flexShrink: 0, display: 'inline-block' },
    stepTitle: { fontSize: '14px', fontWeight: '600', color: c.navy, margin: '0 0 4px 0' },
    stepDesc: { fontSize: '13px', color: c.ink, lineHeight: '1.6', margin: 0 },
    ctaSection: { textAlign: 'center', padding: '28px 0' },
    ctaBtn: { display: 'inline-block', backgroundColor: c.navy, color: c.white, fontWeight: '600', fontSize: '15px', padding: '14px 36px', borderRadius: '6px', textDecoration: 'none', letterSpacing: '0.3px' },
    ctaSub: { fontSize: '12px', color: c.muted, marginTop: '10px', display: 'block' },
    supportGrid: { backgroundColor: c.subtle, border: `1px solid ${c.rule}`, borderRadius: '8px', padding: '20px 24px', marginBottom: '28px' },
    supportItem: { fontSize: '13px', color: c.ink, marginBottom: '8px' },
    footer: { backgroundColor: '#f0f2f8', borderTop: `1px solid ${c.rule}`, padding: '24px 52px' },
    footerBrand: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: '18px', fontWeight: '600', color: c.navy, marginBottom: '6px' },
    footerMeta: { fontSize: '12px', color: c.muted, lineHeight: '1.6', marginBottom: '16px' },
    footerLinks: { marginBottom: '16px' },
    footerLink: { fontSize: '12px', color: '#1a56db', textDecoration: 'none', marginRight: '16px' },
    footerLegal: { fontSize: '11.5px', color: '#9198b5', lineHeight: '1.7', borderTop: `1px solid ${c.rule}`, paddingTop: '16px', marginTop: '8px' },
    hr: { borderColor: c.rule, margin: '0' },
};

export default function WelcomeSchoolEmail({
    schoolName = 'Demo School',
    adminName = 'School Administrator',
    adminEmail = 'admin@school.edu',
    tempPassword = 'Temp@2025!',
    dashboardUrl = 'https://admin.getresqid.in',
    planName = 'Standard Plan',
    planExpiry = 'DD/MM/YYYY',
    cardCount = '100',
}) {
    const refNumber = `RESQID-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    return (
        <Html lang="en">
            <Head>
                <Font fontFamily="Inter" fallbackFontFamily="Helvetica"
                    webFont={{ url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2', format: 'woff2' }}
                    fontWeight={400} fontStyle="normal" />
            </Head>
            <Preview>Welcome to RESQID — {schoolName} has been successfully onboarded</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>

                    {/* META BAR */}
                    <Section style={s.metaBar}>
                        <Row>
                            <Column><Text style={s.metaText}>School Onboarding Notification</Text></Column>
                            <Column align="right"><Text style={{ ...s.metaText, fontFamily: 'monospace', backgroundColor: '#dde0ea', padding: '3px 10px', borderRadius: '20px' }}>REF# {refNumber}</Text></Column>
                        </Row>
                    </Section>

                    <Container style={s.card}>

                        {/* HEADER */}
                        <div style={s.headerStrip} />
                        <Section style={s.headerInner}>
                            <div>
                                <span style={s.brandShield}>🛡</span>
                                <span style={s.brandName}>RESQID</span>
                                <span style={s.brandTagline}>School Safety Management · coreZ Technologies Pvt. Ltd.</span>
                            </div>
                            <div style={s.statusBadge}>
                                <Text style={s.statusText}>● Account Activated</Text>
                            </div>
                            <Heading style={s.headerTitle}>Welcome to RESQID,<br /><strong>{schoolName}</strong></Heading>
                            <Text style={s.headerSub}>
                                Your institution has been successfully registered on the RESQID platform. This letter contains your account credentials and onboarding instructions. Please treat this communication as confidential.
                            </Text>
                        </Section>

                        {/* BODY */}
                        <Section style={s.bodySection}>

                            <Text style={s.salutation}>
                                Dear <strong>{adminName}</strong>,<br /><br />
                                We are pleased to inform you that <strong>{schoolName}</strong> has been officially onboarded to the RESQID School Safety &amp; Emergency ID Management System. Your administrator account is now active and ready for use.<br /><br />
                                Kindly review the account details and follow the onboarding checklist outlined in this letter to complete the setup of your institution's profile.
                            </Text>

                            {/* CREDENTIALS */}
                            <Text style={s.sectionLabel}>Account Credentials</Text>

                            <Section style={s.credTable}>
                                <Section style={s.credHeaderBg}>
                                    <Row>
                                        <Column><Text style={s.credHeaderText}>Field</Text></Column>
                                        <Column><Text style={s.credHeaderText}>Details</Text></Column>
                                    </Row>
                                </Section>
                                {[
                                    { icon: '🏫', key: 'School Name', val: schoolName, note: null },
                                    { icon: '📧', key: 'Admin Email', val: adminEmail, note: 'Use this to log in to your dashboard' },
                                    { icon: '🔑', key: 'Temporary Password', val: tempPassword, note: 'Change immediately upon first login', isPass: true },
                                    { icon: '🌐', key: 'Dashboard URL', val: dashboardUrl, note: 'Accessible via desktop and mobile browser', isLink: true },
                                    { icon: '📋', key: 'Subscription Plan', val: `${planName} — Valid until ${planExpiry}`, note: `${cardCount} QR ID cards included` },
                                ].map(({ icon, key, val, note, isPass, isLink }) => (
                                    <Section key={key} style={s.credRow}>
                                        <Row>
                                            <Column style={{ width: '35%' }}>
                                                <Text style={s.credKey}>{icon} {key}</Text>
                                            </Column>
                                            <Column>
                                                {isLink
                                                    ? <Link href={val} style={s.credValLink}>{val}</Link>
                                                    : <Text style={isPass ? s.credValPass : s.credVal}>{val}</Text>
                                                }
                                                {note && <Text style={s.credNote}>{note}</Text>}
                                            </Column>
                                        </Row>
                                    </Section>
                                ))}
                            </Section>

                            {/* NOTICE */}
                            <Section style={s.noticeBox}>
                                <Text style={s.noticeText}>
                                    ⚠️ <strong>Security Notice:</strong> Your temporary password is system-generated and valid for 48 hours. You are required to change it upon your first login. Do not share your credentials with unauthorised personnel.
                                </Text>
                            </Section>

                            {/* ONBOARDING STEPS */}
                            <Text style={s.sectionLabel}>Onboarding Checklist</Text>
                            <Section style={{ marginTop: '16px', marginBottom: '28px' }}>
                                {[
                                    { n: '01', title: 'Log In & Reset Password', desc: `Access your dashboard at admin.getresqid.in using the temporary credentials above and set a strong, permanent password immediately.` },
                                    { n: '02', title: 'Complete Institution Profile', desc: 'Fill in your school\'s registered address, board affiliation, contact details, and upload an official logo for accurate ID card generation.' },
                                    { n: '03', title: 'Add Student & Staff Records', desc: 'Enroll students individually or perform a bulk import using our pre-formatted CSV template, available in the dashboard under Settings → Import Data.' },
                                    { n: '04', title: 'Review Subscription & QR Allocation', desc: 'Verify your active plan, renewal date, and the number of QR ID cards assigned to your institution under the Subscription tab.' },
                                    { n: '05', title: 'Generate & Distribute QR ID Cards', desc: 'Print or digitally share QR-coded emergency ID cards with students and staff to enable instant identity verification and emergency response.' },
                                ].map(({ n, title, desc }) => (
                                    <Row key={n} style={{ marginBottom: '20px' }}>
                                        <Column style={{ width: '40px', verticalAlign: 'top' }}>
                                            <Text style={s.stepNum}>{n}</Text>
                                        </Column>
                                        <Column style={{ paddingLeft: '12px' }}>
                                            <Text style={s.stepTitle}>{title}</Text>
                                            <Text style={s.stepDesc}>{desc}</Text>
                                        </Column>
                                    </Row>
                                ))}
                            </Section>

                            {/* SUPPORT */}
                            <Text style={s.sectionLabel}>Support & Assistance</Text>
                            <Section style={s.supportGrid}>
                                <Text style={{ fontSize: '14px', fontWeight: '600', color: c.navy, margin: '0 0 12px 0' }}>Our support team is available to assist you throughout the onboarding process.</Text>
                                <Row>
                                    <Column><Text style={s.supportItem}>📧 <Link href="mailto:support@getresqid.in" style={{ color: '#1a56db' }}>support@getresqid.in</Link></Text></Column>
                                    <Column><Text style={s.supportItem}>📞 +91-XXXXXXXXXX</Text></Column>
                                </Row>
                                <Row>
                                    <Column><Text style={s.supportItem}>🕐 Mon – Sat, 9:00 AM – 6:00 PM IST</Text></Column>
                                    <Column><Text style={s.supportItem}>📖 <Link href="https://docs.getresqid.in" style={{ color: '#1a56db' }}>docs.getresqid.in</Link></Text></Column>
                                </Row>
                            </Section>

                            {/* CTA */}
                            <Section style={s.ctaSection}>
                                <Link href={dashboardUrl} style={s.ctaBtn}>Access Your Dashboard</Link>
                                <Text style={s.ctaSub}>{dashboardUrl} · Secure · SSL Encrypted</Text>
                            </Section>

                        </Section>

                        {/* FOOTER */}
                        <Section style={s.footer}>
                            <Text style={s.footerBrand}>RESQID</Text>
                            <Text style={s.footerMeta}>coreZ Technologies Pvt. Ltd.<br />Kolkata, West Bengal, India</Text>
                            <div style={s.footerLinks}>
                                <Link href="https://getresqid.in/privacy" style={s.footerLink}>Privacy Policy</Link>
                                <Link href="https://getresqid.in/terms" style={s.footerLink}>Terms of Service</Link>
                                <Link href="https://getresqid.in/help" style={s.footerLink}>Help Centre</Link>
                            </div>
                            <Text style={s.footerLegal}>
                                This is an automated system-generated communication from coreZ Technologies Pvt. Ltd. intended solely for the designated school administrator. If you believe you have received this in error, please contact <Link href="mailto:support@getresqid.in" style={{ color: '#7a8099' }}>support@getresqid.in</Link> immediately.<br />
                                © {new Date().getFullYear()} coreZ Technologies Pvt. Ltd. All rights reserved.
                            </Text>
                        </Section>

                    </Container>
                </Section>
            </Body>
        </Html>
    );
}