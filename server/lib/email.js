const nodemailer = require('nodemailer');
const dotenv      = require('dotenv');
dotenv.config();

const transporter = nodemailer.createTransport({
  // If you use e.g. Gmail, set EMAIL_SERVICE=gmail in .env
  service: process.env.EMAIL_SERVICE,    // e.g. 'gmail'
  auth: {
    user: process.env.EMAIL_USER,        // full mailbox address
    pass: process.env.EMAIL_PASSWORD     // app‑password / SMTP secret
  }
});

async function sendMatchReminder(match, team, players) {
  try {
    // Collect valid e‑mails
    const emails = players
      .map(p => p.email?.trim())
      .filter(Boolean);

    if (!emails.length) {
      throw new Error('No valid e‑mail addresses found for this team');
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to:   emails.join(','),
      subject: `⚽ Match Reminder: ${team.name} – KFUPM Soccer Tournament`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
                    padding:20px;border:1px solid #e0e0e0;border-radius:5px;">
          <h2 style="color:#10b981;text-align:center;">⚽ Upcoming Match Reminder</h2>
          <p>Dear <strong>${team.name}</strong> team member,</p>
          <p>This is a friendly reminder of your upcoming match:</p>

          <div style="background:#f9fafb;padding:15px;border-radius:5px;margin:15px 0;">
            <p><strong>Tournament:</strong> ${match.tournament_name}</p>
            <p><strong>Match:</strong> ${match.home_team_name} vs ${match.away_team_name}</p>
            <p><strong>Date & Time:</strong> ${new Date(match.match_date).toLocaleString()}</p>
            <p><strong>Location:</strong> ${match.location}</p>
          </div>

          <p>Please arrive at least <strong>30 minutes</strong> before kick‑off.</p>
          <p>Good luck!</p>

          <div style="text-align:center;margin-top:20px;padding-top:15px;
                      border-top:1px solid #e0e0e0;font-size:12px;color:#6b7280;">
            This is an automated message from the KFUPM Soccer Tournament
            Management System – please do not reply.
          </div>
        </div>`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('📨  Reminder sent:', info.messageId);
    return info;                       // return to caller if they need it
  } catch (err) {
    console.error('❌  sendMatchReminder error:', err.message);
    throw err;                         // let route/controller handle the error
  }
}

module.exports = { sendMatchReminder };
