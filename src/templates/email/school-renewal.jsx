// src/templates/email/school-renewal.jsx
// Used for: Subscription renewal notice
// Props: { schoolName, expiryDate, renewUrl }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb', amber: '#d4a017', amberLight: '#fffdf5', red: '#c0392b' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.amber, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    bodySection: { padding: '32px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '12px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    expiryBox: { backgroundColor: c.amberLight, border: `1px solid #f5e6b0`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px', textAlign: 'center' },
    expiryLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: '8px' },
    expiryDate: { fontSize: '24px', fontWeight: '700', color: c.amber, margin: 0 },
    warningBox: { backgroundColor: '#fff9f5', borderLeft: `3px solid ${c.red}`, borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: '24px' },
    warningText: { fontSize: '12.5px', color: '#6b2a10', lineHeight: '1.55', margin: 0 },
    renewBtn: { display: 'block', backgroundColor: c.accent, color: c.white, fontSize: '14px', fontWeight: '600', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', textAlign: 'center', marginBottom: '24px' },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function SchoolRenewalEmail({ schoolName = 'School', expiryDate = '', renewUrl = 'https://getresqid.in/renew' }) {
    return (
        <Html lang="en"><Head />
            <Preview>Your RESQID subscription is expiring soon — {schoolName}</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>⏰</span>
                            <Heading style={s.headerTitle}>Subscription Renewal Due</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {schoolName},</Text>
                            <Text style={s.text}>Your RESQID subscription is expiring soon. Renew now to ensure uninterrupted protection for your students.</Text>
                            <Section style={s.expiryBox}>
                                <span style={s.expiryLabel}>Expires On</span>
                                <Text style={s.expiryDate}>{expiryDate}</Text>
                            </Section>
                            <Section style={s.warningBox}>
                                <Text style={s.warningText}><strong>After expiry</strong>, emergency QR scans will stop working for your students' cards. Renew before the expiry date to avoid any gap in coverage.</Text>
                            </Section>
                            <Link href={renewUrl} style={s.renewBtn}>Renew Now →</Link>
                            <Hr style={s.hr} />
                            <Text style={s.text}>Questions about renewal? <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
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