// src/templates/email/internal-alert.jsx
// Used for: Internal team alert (coreZ team only)
// Props: { alertType, message, data }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

const c = { white: '#ffffff', bg: '#f4f5f7', ink: '#1a1d2e', muted: '#5f6478', border: '#e2e5ee', accent: '#1a3570', accentLight: '#eef1fb', red: '#c0392b', redLight: '#fff5f5' };
const s = {
    body: { backgroundColor: c.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '40px 16px' },
    card: { maxWidth: '480px', margin: '0 auto', backgroundColor: c.white, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' },
    header: { backgroundColor: c.ink, padding: '28px 32px', textAlign: 'center' },
    headerIcon: { fontSize: '36px', display: 'block', marginBottom: '8px' },
    headerTitle: { fontSize: '18px', fontWeight: '700', color: c.white, margin: 0 },
    headerSub: { fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '4px', marginBottom: 0 },
    bodySection: { padding: '32px' },
    badgeRow: { marginBottom: '20px' },
    badge: { display: 'inline-block', backgroundColor: c.redLight, border: `1px solid #f5d0d0`, borderRadius: '6px', padding: '4px 12px', fontSize: '12px', fontWeight: '700', color: c.red, letterSpacing: '0.5px' },
    text: { fontSize: '14px', color: c.muted, lineHeight: '1.65', marginBottom: '20px' },
    messageBox: { backgroundColor: '#f8f9fb', border: `1px solid ${c.border}`, borderRadius: '10px', padding: '16px 20px', marginBottom: '24px' },
    messageText: { fontSize: '14px', color: c.ink, lineHeight: '1.7', margin: 0 },
    dataBox: { backgroundColor: c.accentLight, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '14px 18px', marginBottom: '24px' },
    dataTitle: { fontSize: '11px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: c.muted, display: 'block', marginBottom: '8px' },
    dataText: { fontSize: '12px', color: c.muted, fontFamily: 'monospace', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function InternalAlertEmail({ alertType = 'INTERNAL_ALERT', message = '', data = null }) {
    const dataString = data ? (typeof data === 'string' ? data : JSON.stringify(data, null, 2)) : null;
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    return (
        <Html lang="en"><Head />
            <Preview>[RESQID Internal] {alertType}</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>🔔</span>
                            <Heading style={s.headerTitle}>Internal Alert</Heading>
                            <Text style={s.headerSub}>coreZ Technologies — RESQID</Text>
                        </Section>
                        <Section style={s.bodySection}>
                            <Section style={s.badgeRow}>
                                <span style={s.badge}>{alertType}</span>
                            </Section>

                            <Section style={s.messageBox}>
                                <Text style={s.messageText}>{message}</Text>
                            </Section>

                            {dataString && (
                                <Section style={s.dataBox}>
                                    <span style={s.dataTitle}>Additional Data</span>
                                    <Text style={s.dataText}>{dataString}</Text>
                                </Section>
                            )}

                            <Hr style={s.hr} />
                            <Text style={s.text}>Generated at: {timestamp} IST</Text>
                        </Section>
                        <Section style={s.footer}>
                            <Text style={s.footerText}>© {new Date().getFullYear()} coreZ Technologies Pvt. Ltd. — Internal use only</Text>
                        </Section>
                    </Container>
                </Section>
            </Body>
        </Html>
    );
}