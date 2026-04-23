// src/templates/email/welcome-parent.jsx
// Used for: Parent onboarding after successful card registration
// Props: { parentName, phone, studentName, studentClass, schoolName, cardId, appStoreUrl, playStoreUrl }

import {
    Html, Head, Body, Container, Section,
    Text, Heading, Hr, Link, Preview, Font, Row, Column,
} from '@react-email/components';

const c = {
    navy: '#05112b',
    navy2: '#0d2554',
    red: '#c0392b',
    teal: '#0e8c6a',
    tealLt: '#e8f7f3',
    ink: '#1c2240',
    muted: '#64698a',
    rule: '#e2e6f3',
    bg: '#eef0f6',
    white: '#ffffff',
};

const s = {
    body: { backgroundColor: c.bg, fontFamily: "'Nunito', Helvetica, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '48px 16px' },
    metaBar: { maxWidth: '640px', margin: '0 auto 14px', padding: '0 2px' },
    metaText: { fontSize: '11px', color: '#9296b0', letterSpacing: '0.3px' },
    card: { maxWidth: '640px', margin: '0 auto', backgroundColor: c.white, borderRadius: '6px', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.04), 0 16px 50px rgba(0,0,0,0.09)' },
    headerAccent: { height: '4px', background: 'linear-gradient(90deg, #0e8c6a, #3db88a, #0e8c6a)' },
    headerInner: { backgroundColor: c.navy, padding: '42px 50px 46px' },
    brandShield: { display: 'inline-block', width: '42px', height: '42px', backgroundColor: c.red, borderRadius: '6px', textAlign: 'center', lineHeight: '42px', fontSize: '20px', verticalAlign: 'middle', boxShadow: '0 4px 16px rgba(192,57,43,0.35)' },
    brandName: { fontFamily: 'Georgia, serif', fontSize: '19px', fontWeight: '600', color: c.white, display: 'inline-block', verticalAlign: 'middle', marginLeft: '12px' },
    brandSub: { fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '2.5px', textTransform: 'uppercase', display: 'block', marginTop: '2px' },
    badgeWrap: { display: 'inline-block', backgroundColor: 'rgba(14,140,106,0.15)', border: '1px solid rgba(14,140,106,0.35)', padding: '5px 14px', borderRadius: '2px', marginBottom: '20px', marginTop: '28px' },
    badgeText: { fontSize: '9.5px', fontWeight: '700', letterSpacing: '2px', textTransform: 'uppercase', color: '#3db88a', margin: 0 },
    headerTitle: { fontFamily: 'Georgia, serif', fontSize: '30px', fontWeight: '600', color: c.white, lineHeight: '1.25', marginBottom: '8px' },
    headerSub: { fontSize: '13px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.65', borderLeft: '2px solid rgba(14,140,106,0.5)', paddingLeft: '14px', marginTop: '18px', maxWidth: '400px' },
    childCard: { margin: '0 50px', backgroundColor: c.white, borderRadius: '6px', border: `1px solid ${c.rule}`, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: '-28px', marginBottom: '0' },
    childAvatar: { backgroundColor: c.navy2, width: '72px', textAlign: 'center', fontSize: '30px', padding: '16px 0' },
    childInfo: { padding: '16px 20px' },
    childLabel: { fontSize: '9px', fontWeight: '700', letterSpacing: '2px', textTransform: 'uppercase', color: c.muted, marginBottom: '6px', display: 'block' },
    childName: { fontFamily: 'Georgia, serif', fontSize: '17px', fontWeight: '600', color: c.ink, marginBottom: '4px' },
    childMeta: { fontSize: '12px', color: c.muted },
    childBadge: { backgroundColor: c.tealLt, border: `1px solid ${c.teal}`, borderRadius: '4px', padding: '4px 10px', textAlign: 'center' },
    childBadgeLabel: { fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: c.teal, marginBottom: '2px', display: 'block' },
    childBadgeVal: { fontFamily: 'monospace', fontSize: '13px', fontWeight: '700', color: c.navy, display: 'block' },
    bodySection: { padding: '44px 50px', backgroundColor: c.white },
    salutation: { fontSize: '14.5px', color: c.ink, lineHeight: '1.75', marginBottom: '28px', paddingBottom: '28px', borderBottom: `1px solid ${c.rule}` },
    sectionLabel: { fontSize: '10px', fontWeight: '600', letterSpacing: '2.5px', textTransform: 'uppercase', color: c.muted, borderLeft: `3px solid ${c.teal}`, paddingLeft: '10px', display: 'inline-block', marginBottom: '16px', marginTop: '8px' },
    credTable: { width: '100%', border: `1px solid #e4e7f2`, borderRadius: '4px', overflow: 'hidden', marginBottom: '24px' },
    credHeaderBg: { backgroundColor: c.navy, padding: '10px 20px' },
    credHeaderText: { fontSize: '9.5px', fontWeight: '600', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0 },
    credRow: { padding: '14px 20px', borderBottom: `1px solid ${c.rule}`, backgroundColor: c.white },
    credKey: { fontSize: '13px', color: c.muted, fontWeight: '500' },
    credVal: { fontSize: '14px', color: c.navy, fontWeight: '600', margin: '0 0 2px 0' },
    credNote: { fontSize: '11.5px', color: c.muted, margin: 0 },
    noticeBox: { backgroundColor: '#fffbf0', border: '1px solid #f5d87a', borderRadius: '6px', padding: '14px 18px', marginBottom: '28px' },
    noticeText: { fontSize: '13.5px', color: '#5c4a00', lineHeight: '1.6', margin: 0 },
    appSection: { backgroundColor: '#f6f9ff', border: `1px solid ${c.rule}`, borderRadius: '8px', padding: '20px 24px', marginBottom: '28px' },
    appTitle: { fontSize: '15px', fontWeight: '700', color: c.navy, margin: '0 0 8px 0' },
    appDesc: { fontSize: '13.5px', color: c.ink, lineHeight: '1.65', margin: '0 0 16px 0' },
    appBtn: { display: 'inline-block', backgroundColor: c.navy, color: c.white, fontSize: '13px', fontWeight: '600', padding: '10px 20px', borderRadius: '6px', textDecoration: 'none', marginRight: '10px' },
    featuresGrid: { marginBottom: '28px' },
    featureCard: { backgroundColor: '#f9fafc', border: `1px solid ${c.rule}`, borderRadius: '8px', padding: '16px 20px', marginBottom: '12px' },
    featureIcon: { fontSize: '24px', marginBottom: '8px', display: 'block' },
    featureTitle: { fontSize: '14px', fontWeight: '700', color: c.navy, margin: '0 0 4px 0' },
    featureDesc: { fontSize: '13px', color: c.ink, lineHeight: '1.6', margin: 0 },
    stepItem: { marginBottom: '16px' },
    stepNum: { display: 'inline-block', width: '26px', height: '26px', backgroundColor: c.navy, borderRadius: '50%', textAlign: 'center', lineHeight: '26px', color: c.white, fontSize: '11px', fontWeight: '700', verticalAlign: 'middle', marginRight: '12px' },
    stepTitle: { fontSize: '14px', fontWeight: '600', color: c.navy, margin: '0 0 4px 0' },
    stepDesc: { fontSize: '13px', color: c.ink, lineHeight: '1.6', margin: '0 0 0 38px' },
    ctaWrap: { textAlign: 'center', padding: '28px 0' },
    ctaBtn: { display: 'inline-block', backgroundColor: c.teal, color: c.white, fontWeight: '700', fontSize: '15px', padding: '14px 36px', borderRadius: '6px', textDecoration: 'none' },
    ctaSub: { fontSize: '12px', color: c.muted, marginTop: '10px', display: 'block' },
    footer: { backgroundColor: '#f0f2f8', borderTop: `1px solid ${c.rule}`, padding: '24px 52px' },
    footerBrand: { fontFamily: 'Georgia, serif', fontSize: '18px', fontWeight: '600', color: c.navy, marginBottom: '6px' },
    footerAddr: { fontSize: '12px', color: c.muted, lineHeight: '1.6', marginBottom: '16px' },
    footerLink: { fontSize: '12px', color: '#1a56db', textDecoration: 'none', marginRight: '16px' },
    footerLegal: { fontSize: '11.5px', color: '#9198b5', lineHeight: '1.7', borderTop: `1px solid ${c.rule}`, paddingTop: '16px', marginTop: '8px' },
};

export default function WelcomeParentEmail({
    parentName = 'Parent',
    phone = '+91-XXXXXXXXXX',
    studentName = 'Student Name',
    studentClass = 'Class X',
    schoolName = 'School Name',
    cardId = 'RQ-XXXX-XXXXXX',
    appStoreUrl = '#',
    playStoreUrl = '#',
}) {
    const refNumber = `RESQID-P-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    return (
        <Html lang="en">
            <Head>
                <Font fontFamily="Nunito" fallbackFontFamily="Helvetica"
                    webFont={{ url: 'https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di8HDDkhRjtnj6zbXWjgeg.woff2', format: 'woff2' }}
                    fontWeight={400} fontStyle="normal" />
            </Head>
            <Preview>Welcome to RESQID — {studentName}'s emergency ID card is ready</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>

                    {/* META BAR */}
                    <Section style={s.metaBar}>
                        <Row>
                            <Column><Text style={s.metaText}>Parent Onboarding Notification</Text></Column>
                            <Column align="right"><Text style={{ ...s.metaText, fontFamily: 'monospace', backgroundColor: '#dde0ee', padding: '3px 10px', borderRadius: '20px' }}>REF# {refNumber}</Text></Column>
                        </Row>
                    </Section>

                    <Container style={s.card}>
                        {/* HEADER */}
                        <div style={s.headerAccent} />
                        <Section style={s.headerInner}>
                            <div>
                                <span style={s.brandShield}>🛡</span>
                                <span style={s.brandName}>RESQID</span>
                                <span style={s.brandSub}>School Safety Management · coreZ Technologies Pvt. Ltd.</span>
                            </div>
                            <div style={s.badgeWrap}>
                                <Text style={s.badgeText}>● Registration Complete</Text>
                            </div>
                            <Heading style={s.headerTitle}>Welcome to RESQID,<br /><em style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.75)' }}>{parentName}</em></Heading>
                            <Text style={s.headerSub}>
                                Your child's RESQID emergency profile has been successfully created. Please find below your account credentials and instructions to get started with the RESQID Parent App.
                            </Text>
                        </Section>

                        {/* CHILD CARD */}
                        <Section style={{ padding: '0 50px', backgroundColor: c.white, paddingTop: '0' }}>
                            <Container style={s.childCard}>
                                <Row>
                                    <Column style={{ width: '72px', backgroundColor: c.navy2, textAlign: 'center', padding: '16px 0', fontSize: '30px' }}>
                                        👦
                                    </Column>
                                    <Column style={s.childInfo}>
                                        <span style={s.childLabel}>Enrolled Student</span>
                                        <Text style={s.childName}>{studentName}</Text>
                                        <Text style={s.childMeta}>{studentClass} · {schoolName}</Text>
                                    </Column>
                                    <Column style={{ width: '120px', padding: '12px 16px', textAlign: 'center' }}>
                                        <div style={s.childBadge}>
                                            <span style={s.childBadgeLabel}>Card ID</span>
                                            <span style={s.childBadgeVal}>{cardId}</span>
                                        </div>
                                    </Column>
                                </Row>
                            </Container>
                        </Section>

                        {/* BODY */}
                        <Section style={s.bodySection}>

                            <Text style={s.salutation}>
                                Dear <strong>{parentName}</strong>,<br /><br />
                                We are delighted to confirm that your child <strong>{studentName}</strong>'s RESQID Emergency ID has been successfully created and linked to your account. You can now manage your child's emergency profile, update contacts, and download the QR ID card — all from the RESQID Parent App.
                            </Text>

                            {/* APP DOWNLOAD */}
                            <Text style={s.sectionLabel}>Download the Parent App</Text>
                            <Section style={s.appSection}>
                                <Text style={s.appTitle}>RESQID Parent App</Text>
                                <Text style={s.appDesc}>Track your child's emergency ID, receive real-time safety alerts, update emergency contacts, and view your child's profile — all from one place.</Text>
                                <div>
                                    <Link href={appStoreUrl} style={s.appBtn}>🍎 App Store</Link>
                                    <Link href={playStoreUrl} style={{ ...s.appBtn, backgroundColor: '#1a7a50' }}>🤖 Google Play</Link>
                                </div>
                            </Section>

                            {/* FEATURES */}
                            <Text style={s.sectionLabel}>What RESQID Does for Your Child</Text>
                            <Section style={s.featuresGrid}>
                                <Row>
                                    <Column style={{ paddingRight: '8px' }}>
                                        <Section style={s.featureCard}>
                                            <span style={s.featureIcon}>🆔</span>
                                            <Text style={s.featureTitle}>QR Emergency ID Card</Text>
                                            <Text style={s.featureDesc}>A unique QR code that instantly reveals your child's name, class, school, blood group, and emergency contacts when scanned.</Text>
                                        </Section>
                                    </Column>
                                    <Column style={{ paddingLeft: '8px' }}>
                                        <Section style={s.featureCard}>
                                            <span style={s.featureIcon}>🚨</span>
                                            <Text style={s.featureTitle}>Emergency Alerts</Text>
                                            <Text style={s.featureDesc}>Receive instant SMS and app notifications if your child's QR ID is scanned in an emergency situation.</Text>
                                        </Section>
                                    </Column>
                                </Row>
                                <Row>
                                    <Column style={{ paddingRight: '8px' }}>
                                        <Section style={s.featureCard}>
                                            <span style={s.featureIcon}>👨‍👩‍👧</span>
                                            <Text style={s.featureTitle}>Emergency Contacts</Text>
                                            <Text style={s.featureDesc}>Add up to 3 emergency contacts who will be notified instantly in the event of a school-reported incident.</Text>
                                        </Section>
                                    </Column>
                                    <Column style={{ paddingLeft: '8px' }}>
                                        <Section style={s.featureCard}>
                                            <span style={s.featureIcon}>🏥</span>
                                            <Text style={s.featureTitle}>Medical Information</Text>
                                            <Text style={s.featureDesc}>Store your child's blood group, allergies, and medical conditions securely — accessible during an emergency.</Text>
                                        </Section>
                                    </Column>
                                </Row>
                            </Section>

                            {/* STEPS */}
                            <Text style={s.sectionLabel}>Getting Started</Text>
                            <Section style={{ marginTop: '16px', marginBottom: '28px' }}>
                                {[
                                    { n: '01', title: 'Download the RESQID Parent App', desc: 'Available on the App Store and Google Play. Search for "RESQID Parent" or use the links above.' },
                                    { n: '02', title: 'Log In with Your Phone Number', desc: `Use ${phone} to log in via OTP verification.` },
                                    { n: '03', title: "Complete Your Child's Profile", desc: "Add your child's photo, blood group, known allergies, and any critical medical information." },
                                    { n: '04', title: 'Add Emergency Contacts', desc: 'Add up to 3 emergency contacts (yourself, spouse, or a trusted relative) who will be notified in emergencies.' },
                                    { n: '05', title: 'Download & Keep the QR ID Card', desc: "Download your child's QR Emergency ID Card from the app and ensure they carry it in their school bag at all times." },
                                ].map(({ n, title, desc }) => (
                                    <Section key={n} style={s.stepItem}>
                                        <Text style={{ margin: '0 0 4px 0' }}>
                                            <span style={s.stepNum}>{n}</span>
                                            <span style={s.stepTitle}>{title}</span>
                                        </Text>
                                        <Text style={s.stepDesc}>{desc}</Text>
                                    </Section>
                                ))}
                            </Section>

                            {/* CTA */}
                            <Section style={s.ctaWrap}>
                                <Link href={appStoreUrl} style={s.ctaBtn}>Open Parent App →</Link>
                                <Text style={s.ctaSub}>Or visit <Link href="https://app.getresqid.in" style={{ color: '#1a56db' }}>app.getresqid.in</Link> from your browser</Text>
                            </Section>

                        </Section>

                        {/* FOOTER */}
                        <Section style={s.footer}>
                            <Text style={s.footerBrand}>RESQID</Text>
                            <Text style={s.footerAddr}>coreZ Technologies Pvt. Ltd.<br />Kolkata, West Bengal, India</Text>
                            <div>
                                <Link href="https://getresqid.in/privacy" style={s.footerLink}>Privacy Policy</Link>
                                <Link href="https://getresqid.in/terms" style={s.footerLink}>Terms of Service</Link>
                                <Link href="https://getresqid.in/help" style={s.footerLink}>Help Centre</Link>
                            </div>
                            <Text style={s.footerLegal}>
                                This is a system-generated communication from coreZ Technologies Pvt. Ltd. intended for the registered parent/guardian of the enrolled student. If you received this in error, please contact <Link href="mailto:support@getresqid.in" style={{ color: '#7a8099' }}>support@getresqid.in</Link> immediately.<br />
                                © {new Date().getFullYear()} coreZ Technologies Pvt. Ltd. All rights reserved.
                            </Text>
                        </Section>

                    </Container>
                </Section>
            </Body>
        </Html>
    );
}