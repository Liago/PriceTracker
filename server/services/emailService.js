const nodemailer = require('nodemailer');

// Create reusable transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST || 'smtp.gmail.com',
	port: process.env.SMTP_PORT || 587,
	secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
	},
});

/**
 * Send an email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @returns {Promise<Object>} - Nodemailer info
 */
async function sendEmail({ to, subject, html }) {
	if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
		console.log('[Email Service] SMTP credentials not found. simulating email send:');
		console.log(`To: ${to}`);
		console.log(`Subject: ${subject}`);
		console.log('--- Content ---');
		// console.log(html); 
		console.log('--- End Content ---');
		return { messageId: 'mock-id', response: 'Simulated success' };
	}

	try {
		const info = await transporter.sendMail({
			from: process.env.SMTP_FROM || '"PriceTracker" <noreply@pricetracker.com>',
			to,
			subject,
			html,
		});

		console.log('[Email Service] Message sent: %s', info.messageId);
		return info;
	} catch (error) {
		console.error('[Email Service] Error sending email:', error);
		// Don't throw, just log. We don't want to crash the scraper/tracker loop.
		return null;
	}
}

/**
 * Send a price drop notification
 * @param {string} userEmail - User's email address
 * @param {Object} product - Product object
 * @param {number} oldPrice - Previous price
 * @param {number} newPrice - New (lower) price
 */
async function sendPriceDropNotification(userEmail, product, oldPrice, newPrice) {
	const savings = (oldPrice - newPrice).toFixed(2);
	const currency = product.currency || 'EUR';

	const subject = `🔥 Price Drop Alert: ${product.name.substring(0, 50)}...`;

	const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Good news! A price you are tracking has dropped.</h2>
      
      <div style="border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <img src="${product.image}" alt="${product.name}" style="max-width: 100px; max-height: 100px; object-fit: contain; float: left; margin-right: 15px;">
        <div style="overflow: hidden;">
          <h3 style="margin-top: 0;"><a href="${product.url}" style="text-decoration: none; color: #111827;">${product.name}</a></h3>
          <p style="font-size: 1.1em;">
            <span style="text-decoration: line-through; color: #6b7280;">${currency} ${oldPrice}</span>
            <span style="color: #ef4444; font-weight: bold; margin-left: 10px;">${currency} ${newPrice}</span>
          </p>
          <p style="color: #059669; font-weight: bold;">You save ${currency} ${savings}!</p>
        </div>
        <div style="clear: both;"></div>
      </div>

      <p>Target Price was: ${currency} ${product.target_price}</p>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="${product.url}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Deal</a>
      </div>
      
      <hr style="margin-top: 40px; border: none; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 0.8em; color: #9ca3af; text-align: center;">You are receiving this because you enabled alerts for this product on PriceTracker.</p>
    </div>
  `;

	return sendEmail({ to: userEmail, subject, html });
}

module.exports = {
	sendEmail,
	sendPriceDropNotification
};
