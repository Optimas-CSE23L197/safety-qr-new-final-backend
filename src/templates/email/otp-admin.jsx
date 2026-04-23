// src/templates/email/otp-admin.jsx
// Used for: Super Admin + School User OTP verification
// Props: { userName, otpCode, expiryMinutes }

import {
    Html, Head, Body, Container, Section, Row, Column,
    Text, Heading, Hr, Link, Preview, Font,
} from '@react-email/components';

const styles = {
    body: { backgroundColor: '#f0f2f5', fontFamily: "'DM Sans', sans-serif", margin: 0, padding: 0 },
    wrapper: { padding: '48px 16px' },
    card: { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.08)' },
    header: { background: 'linear-gradient(135deg, #0f1c3f 0%, #1a3570 60%, #1e4db7 100%)', padding: '40px 48px 36px' },
    logoRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' },
    logoIcon: { width: '38px', height: '38px', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)', textAlign: 'center', lineHeight: '38px', fontSize: '18px' },
    logoName: { fontFamily: "'Sora', sans-serif", fontSize: '20px', fontWeight: '700', color: '#ffffff', letterSpacing: '0.3px', display: 'inline-block', verticalAlign: 'middle', marginLeft: '10px' },
    headerTitle: { fontFamily: "'Sora', sans-serif", fontSize: '26px', fontWeight: '700', color: '#ffffff', lineHeight: '1.2', marginBottom: '6px', margin: '0 0 6px 0' },
    headerSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.65)', fontWeight: '400', margin: 0 },
    body: { padding: '40px 48px' },
    greeting: { fontSize: '16px', color: '#1a1e2e', marginBottom: '16px', fontWeight: '500' },
    introText: { fontSize: '15px', color: '#4a5270', lineHeight: '1.7', marginBottom: '32px' },
    otpSection: { backgroundColor: '#f6f8ff', border: '1.5px solid #d6defc', borderRadius: '16px', padding: '28px 24px', textAlign: 'center', marginBottom: '28px' },
    otpLabel: { fontSize: '12px', fontWeight: '600', letterSpacing: '1.4px', textTransform: 'uppercase', color: '#7b8bb2', marginBottom: '14px', display: 'block' },
    otpCode: { fontFamily: "'Sora', sans-serif", fontSize: '44px', fontWeight: '700', color: '#1a3570', letterSpacing: '10px', lineHeight: '1', marginBottom: '14px', display: 'block' },
    otpExpiry: { display: 'inline-block', backgroundColor: '#fff3cd', border: '1px solid #ffe08a', borderRadius: '20px', padding: '5px 14px', fontSize: '12.5px', fontWeight: '500', color: '#7a5c00' },
    warningBox: { backgroundColor: '#fff8f6', borderLeft: '4px solid #e8440a', borderRadius: '0 10px 10px 0', padding: '14px 18px', marginBottom: '24px' },
    warningText: { fontSize: '13.5px', color: '#5c2a14', lineHeight: '1.6', margin: 0 },
    fallbackBox: { backgroundColor: '#f9fafc', border: '1px solid #e5e8f2', borderRadius: '12px', padding: '16px 20px', marginBottom: '28px' },
    fallbackText: { fontSize: '13.5px', color: '#6b7394', lineHeight: '1.65', margin: 0 },
    closing: { fontSize: '15px', color: '#4a5270', lineHeight: '1.7', marginBottom: '24px' },
    teamName: { fontFamily: "'Sora', sans-serif", fontWeight: '700', color: '#1a3570' },
    footer: { backgroundColor: '#f6f8ff', borderTop: '1px solid #e5e8f2', padding: '24px 48px', textAlign: 'center' },
    footerText: { fontSize: '12.5px', color: '#9198b5', lineHeight: '1.7', margin: '0 0 10px 0' },
    footerLink: { color: '#1a3570', textDecoration: 'none', fontWeight: '500' },
    hr: { borderColor: '#eaecf4', margin: '28px 0' },
};

export default function OtpAdminEmail({ userName = 'Admin', otpCode = '000000', expiryMinutes = 5 }) {
    return (
        <Html lang="en">
            <Head>
                <Font
                    fontFamily="DM Sans"
                    fallbackFontFamily="Helvetica"
                    webFont={{ url: 'https://fonts.gstatic.com/s/dmsans/v15/rP2tp2ywxg089UriI5-g4vlH9VoD8Cmcqbu6-K6z9mXgjU0.woff2', format: 'woff2' }}
                    fontWeight={400}
                    fontStyle="normal"
                />
                <Font
                    fontFamily="Sora"
                    fallbackFontFamily="Helvetica"
                    webFont={{ url: 'https://fonts.gstatic.com/s/sora/v12/xMQOuFFYT72X5wkB_18qmnndmSdSnk-DKQJRBg.woff2', format: 'woff2' }}
                    fontWeight={700}
                    fontStyle="normal"
                />
            </Head>
            <Preview>Your RESQID verification code is {otpCode} — valid for {expiryMinutes} minutes</Preview>
            <Body style={styles.body}>
                <Section style={styles.wrapper}>
                    <Container style={styles.card}>

                        {/* HEADER */}
                        <Section style={styles.header}>
                            <div>
                                <span style={styles.logoIcon}>🛡</span>
                                <span style={styles.logoName}>RESQID</span>
                            </div>
                            <Heading style={styles.headerTitle}>Verify Your Identity</Heading>
                            <Text style={styles.headerSubtitle}>One-Time Password for secure login</Text>
                        </Section>

                        {/* BODY */}
                        <Section style={styles.body}>
                            <Text style={styles.greeting}>Hello, {userName} 👋</Text>

                            <Text style={styles.introText}>
                                We received a login request for your <strong>RESQID</strong> account. To complete verification and securely access your account, please use the one-time password below.
                            </Text>

                            {/* OTP Block */}
                            <Section style={styles.otpSection}>
                                <span style={styles.otpLabel}>Your One-Time Password</span>
                                <span style={styles.otpCode}>{otpCode}</span>
                                <span style={styles.otpExpiry}>⏱ Expires in {expiryMinutes} minutes</span>
                            </Section>

                            {/* Warning */}
                            <Section style={styles.warningBox}>
                                <Text style={styles.warningText}>
                                    <strong style={{ color: '#c0360a' }}>Never share this code with anyone.</strong> RESQID will never ask for your OTP via phone, email, or chat. If someone requests this code, it is a scam — please ignore it immediately.
                                </Text>
                            </Section>

                            <Hr style={styles.hr} />

                            {/* Fallback */}
                            <Section style={styles.fallbackBox}>
                                <Text style={styles.fallbackText}>
                                    <strong>Didn't request this?</strong> If you did not attempt to log in, please disregard this email. Your account remains secure. If concerned, contact{' '}
                                    <Link href="mailto:support@getresqid.in" style={styles.footerLink}>support@getresqid.in</Link>.
                                </Text>
                            </Section>

                            {/* Closing */}
                            <Text style={styles.closing}>
                                We're committed to keeping your RESQID account safe and secure. Thank you for trusting us.
                                <br /><br />
                                Warm regards,<br />
                                <span style={styles.teamName}>Team RESQID</span>
                            </Text>
                        </Section>

                        {/* FOOTER */}
                        <Section style={styles.footer}>
                            <Text style={styles.footerText}>
                                Need help? <Link href="mailto:support@getresqid.in" style={styles.footerLink}>support@getresqid.in</Link>
                                {' · '}
                                <Link href="https://getresqid.in/privacy" style={styles.footerLink}>Privacy Policy</Link>
                            </Text>
                            <Text style={styles.footerText}>
                                © {new Date().getFullYear()} coreZ Technologies Pvt. Ltd. All rights reserved.<br />
                                This is an automated message — please do not reply directly to this email.
                            </Text>
                        </Section>

                    </Container>
                </Section>
            </Body>
        </Html>
    );
}