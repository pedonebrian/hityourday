import sgMail from '@sendgrid/mail';

if (!process.env.SENDGRID_TOKEN) {
  console.warn('⚠️ SENDGRID_TOKEN is not set');
}

sgMail.setApiKey(process.env.SENDGRID_TOKEN);

export async function sendEmail({ to, subject, text, html }) {
  try {
    const msg = {
      to,
      from: {
        email: 'brian@boxingchange.com', // MUST be verified in SendGrid
        name: 'Hit Your Day'
      },
      subject,
      text,
      html: html || text?.replace(/\n/g, '<br>'),
    };

    const response = await sgMail.send(msg);

    console.log('📧 SendGrid success:', {
      to,
      statusCode: response[0]?.statusCode
    });

    return true;
  } catch (error) {
    console.error('❌ SendGrid error:', {
      message: error.message,
      response: error.response?.body
    });

    throw error;
  }
}