// src/templates/email/order-refunded.jsx
// Used for: Refund confirmation
// Props: { schoolName, orderNumber, amount }
import React from 'react';
import { Html, Head, Body, Container, Section, Text, Heading, Link, Preview, Hr } from '@react-email/components';

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
    refundBox: { backgroundColor: c.amberLight, border: `1px solid #f5e6b0`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' },
    refundRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '10px' },
    refundLabel: { fontSize: '13px', color: c.muted },
    refundValue: { fontSize: '13px', color: c.ink, fontWeight: '600' },
    amountRow: { borderTop: `1px solid #f5e6b0`, paddingTop: '10px', display: 'flex', justifyContent: 'space-between' },
    amountLabel: { fontSize: '14px', color: c.ink, fontWeight: '600' },
    amountValue: { fontSize: '16px', color: c.amber, fontWeight: '700' },
    hr: { borderColor: c.border, margin: '24px 0' },
    link: { color: c.accent, textDecoration: 'none', fontWeight: '500' },
    footer: { borderTop: `1px solid ${c.border}`, padding: '20px 32px', textAlign: 'center' },
    footerText: { fontSize: '12px', color: '#9ca1b0', lineHeight: '1.7', margin: 0 },
    footerLink: { color: '#9ca1b0', textDecoration: 'underline' },
};

export default function OrderRefundedEmail({ schoolName = 'School', orderNumber = '', amount = '0' }) {
    return (
        <Html lang="en"><Head />
            <Preview>Refund processed for order #{orderNumber} — RESQID</Preview>
            <Body style={s.body}>
                <Section style={s.wrapper}>
                    <Container style={s.card}>
                        <Section style={s.header}>
                            <span style={s.headerIcon}>↩️</span>
                            <Heading style={s.headerTitle}>Refund Processed</Heading>
                        </Section>
                        <Section style={s.bodySection}>
                            <Text style={s.greeting}>Hi {schoolName},</Text>
                            <Text style={s.text}>Your refund has been processed. Please allow 5–7 business days for the amount to reflect in your account.</Text>
                            <Section style={s.refundBox}>
                                <Section style={s.refundRow}>
                                    <Text style={s.refundLabel}>Order Number</Text>
                                    <Text style={s.refundValue}>#{orderNumber}</Text>
                                </Section>
                                <Section style={s.amountRow}>
                                    <Text style={s.amountLabel}>Refund Amount</Text>
                                    <Text style={s.amountValue}>{amount}</Text>
                                </Section>
                            </Section>
                            <Text style={s.text}>If you have questions about this refund, please contact us.</Text>
                            <Hr style={s.hr} />
                            <Text style={s.text}><Link href="mailto:support@getresqid.in" style={s.link}>support@getresqid.in</Link></Text>
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