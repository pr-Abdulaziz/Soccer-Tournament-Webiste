import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Send match reminder email to team members
export const sendMatchReminder = async (match, team, players) => {
  try {
    const emails = players.map(player => player.email).filter(Boolean);
    
    if (emails.length === 0) {
      throw new Error('No valid email addresses found');
    }
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: emails.join(', '),
      subject: `⚽ Match Reminder: ${team.name} - KFUPM Soccer Tournament`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #10b981; text-align: center;">⚽ Upcoming Match Reminder</h2>
          <p>Dear ${team.name} team member,</p>
          <p>This is a reminder about your upcoming match:</p>
          
          <div style="background-color: #f9fafb; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Tournament:</strong> ${match.tournament_name}</p>
            <p><strong>Match:</strong> ${match.home_team_name} vs ${match.away_team_name}</p>
            <p><strong>Date & Time:</strong> ${new Date(match.match_date).toLocaleString()}</p>
            <p><strong>Location:</strong> ${match.location}</p>
          </div>
          
          <p>Please arrive at least 30 minutes before the match starts.</p>
          <p>Good luck!</p>
          
          <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
            <p style="color: #6b7280; font-size: 12px;">
              This is an automated message from the KFUPM Soccer Tournament Management System.
              Please do not reply to this email.
            </p>
          </div>
        </div>
      `
    };
    
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

export default { sendMatchReminder };