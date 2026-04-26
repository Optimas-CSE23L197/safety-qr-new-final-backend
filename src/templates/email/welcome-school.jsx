// src/templates/email/welcome-school.jsx
// Used for: School/institution welcome after onboarding
// Props: { schoolName, adminName, adminEmail, tempPassword, dashboardUrl, planName, planExpiry, cardCount }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb', gold: '#d4a017', green: '#1a7a4a', greenLight: '#f0faf4' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.accent, padding: '32px 36px', textAlign: 'center' },
    logo: { fontSize: '22px', fontWeight: '700', color: c.white, letterSpacing: '0.5px', margin: 0 },
    logoDot: { color: c.gold },
    tagline: { fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '4px', marginBottom: 0 },
    bodySection: { padding: '36px' },
    greeting: { fontSize: '16px', color: c.ink, marginBottom: '8px', fontWeight: '600' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    schoolBox: { backgroundColor: c.accentLight, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px', textAlign: 'center' },
    schoolName: { fontSize: '20px', fontWeight: '700', color: c.accent, margin: 0 },
    credBox: { backgroundColor: '#fffdf5', border: `1px solid #f0e0a0`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' },
    credTitle: { fontSize: '12px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, marginBottom: '14px', display: 'block' },
    credRow: { marginBottom: '10px' },
    credLabel: { fontSize: '11px', fontWeight: '600', color: c.muted, display: 'block', marginBottom: '2px' },
    credValue: { fontSize: '14px', color: c.ink, fontWeight: '500', fontFamily: 'monospace', margin: 0 },
    planBox: { backgroundColor: c.greenLight, border: `1px solid #b8e8cc`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px' },
    planRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' },
    planLabel: { fontSize: '12px', color: c.muted },
    planValue: { fontSize: '13px', color: c.green, fontWeight: '600' },
    dashBtn: { display: 'block', backgroundColor: c.accent, color: c.white, fontSize: '14px', fontWeight: '600', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', textAlign: 'center', marginBottom: '24px' },
    warningBox: { backgroundColor: '#fff9f5', borderLeft: `3px solid #c0392b`, borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: '20px' },
    warningText: { fontSize: '12.5px', color: '#6b2a10', lineHeight: '1.55', margin: 0 },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function WelcomeSchoolEmail({ schoolName = 'School', adminName = 'Admin', adminEmail = '', tempPassword = '', dashboardUrl = 'https://admin.getresqid.in', planName = null, planExpiry = null, cardCount = null }) {
    return (
        <Html lang="en"><Head />
            <Preview>Welcome to RESQID — {schoolName} is now onboarded</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <Heading style={s.logo}>RESQID<span style={s.logoDot}>.</span></Heading>
                            <Text style={s.tagline}>QR-based Student Emergency Identity</Text>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {adminName},</Text>
                            <Text style={s.text}>Welcome to RESQID. Your school has been successfully onboarded. Here are your login credentials and plan details.</Text>

                            <Section style={s.schoolBox}>
                                <Text style={s.schoolName}>{schoolName}</Text>
                            </Section>

                            <Section style={s.credBox}>
                                <span style={s.credTitle}>Your Login Credentials</span>
                                <Section style={s.credRow}>
                                    <span style={s.credLabel}>Email</span>
                                    <Text style={s.credValue}>{adminEmail}</Text>
                                </Section>
                                <Section style={s.credRow}>
                                    <span style={s.credLabel}>Temporary Password</span>
                                    <Text style={s.credValue}>{tempPassword}</Text>
                                </Section>
                            </Section>

                            <Section style={s.warningBox}>
                                <Text style={s.warningText}><strong>Change your password immediately</strong> after your first login. This temporary password expires in 24 hours.</Text>
                            </Section>

                            {(planName || planExpiry || cardCount) && (
                                <Section style={s.planBox}>
                                    {planName && <Text style={{ fontSize: '13px', color: c.green, fontWeight: '600', marginBottom: '8px' }}>Plan: {planName}</Text>}
                                    {cardCount && <Text style={{ fontSize: '13px', color: c.muted, margin: '0 0 4px' }}>Cards: {cardCount} students</Text>}
                                    {planExpiry && <Text style={{ fontSize: '13px', color: c.muted, margin: 0 }}>Valid until: {planExpiry}</Text>}
                                </Section>
                            )}

                            <Link href={dashboardUrl} style={s.dashBtn}>Go to Dashboard →</Link>

                            <Hr style={s.hr} />
                            <Text style={s.text}>Need help getting started? <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
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