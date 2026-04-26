// src/templates/email/card-renewal-requested.jsx
// Used for: Card renewal request notification to school admin
// Props: { studentName, schoolName, parentPhone }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.accent, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    bodySection: { padding: '32px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '12px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    requestBox: { backgroundColor: c.accentLight, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px' },
    detailRow: { marginBottom: '10px' },
    detailLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, marginBottom: '2px', display: 'block' },
    detailValue: { fontSize: '14px', color: c.ink, fontWeight: '500', margin: 0 },
    dashBtn: { display: 'block', backgroundColor: c.accent, color: c.white, fontSize: '14px', fontWeight: '600', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', textAlign: 'center', marginBottom: '20px' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function CardRenewalRequestedEmail({ studentName = 'Student', schoolName = 'School', parentPhone = null }) {
    return (
        <Html lang="en"><Head />
            <Preview>Card renewal requested for {studentName} — RESQID</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>🔄</span>
                            <Heading style={s.headerTitle}>Card Renewal Requested</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {schoolName} Admin,</Text>
                            <Text style={s.text}>A parent has requested a card renewal for one of your students. Please review and process this from your dashboard.</Text>
                            <Section style={s.requestBox}>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>Student</span>
                                    <Text style={s.detailValue}>{studentName}</Text>
                                </Section>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>School</span>
                                    <Text style={s.detailValue}>{schoolName}</Text>
                                </Section>
                                {parentPhone && (
                                    <Section style={{ ...s.detailRow, marginBottom: 0 }}>
                                        <span style={s.detailLabel}>Parent Contact</span>
                                        <Text style={s.detailValue}>{parentPhone}</Text>
                                    </Section>
                                )}
                            </Section>
                            <Link href="https://admin.getresqid.in" style={s.dashBtn}>Go to Dashboard →</Link>
                            <Text style={s.text}>Questions? <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
                        </Section>
                        <Section style={s.footer}>
                            <Text style={s.footerText}>© {new Date().getFullYear()} coreZ Technologies Pvt. Ltd.<br /><Link href="https://getresqid.in/privacy" style={s.footerLink}>Privacy</Link> · <Link href="https://getresqid.in/terms" style={s.footerLink}>Terms</Link></Text>
                        </Section>
                    </Container>
                </Section>
            </Body>
        </Html>
    );
}