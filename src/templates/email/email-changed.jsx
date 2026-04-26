// src/templates/email/email-changed.jsx
// Used for: Security alert when email is changed
// Props: { parentName, oldEmail, newEmail }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', amber: '#d4a017', amberLight: '#fffdf5' };
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
    detailBox: { backgroundColor: c.amberLight, border: `1px solid #f5e6b0`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px' },
    detailRow: { marginBottom: '10px' },
    detailLabel: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, marginBottom: '2px', display: 'block' },
    detailValue: { fontSize: '14px', color: c.ink, fontWeight: '500', margin: 0 },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function EmailChangedEmail({ parentName = 'Parent', oldEmail = '', newEmail = '' }) {
    return (
        <Html lang="en"><Head />
            <Preview>Your RESQID email address was changed</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>✉️</span>
                            <Heading style={s.headerTitle}>Email Address Updated</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {parentName},</Text>
                            <Text style={s.text}>The email address on your RESQID account was recently changed.</Text>
                            <Section style={s.detailBox}>
                                <Section style={s.detailRow}>
                                    <span style={s.detailLabel}>Old Email</span>
                                    <Text style={s.detailValue}>{oldEmail}</Text>
                                </Section>
                                <Section style={{ ...s.detailRow, marginBottom: 0 }}>
                                    <span style={s.detailLabel}>New Email</span>
                                    <Text style={s.detailValue}>{newEmail}</Text>
                                </Section>
                            </Section>
                            <Text style={s.text}>If you made this change, no action is needed. If you didn't, contact us immediately at <Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
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