import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_KEY);

export const sendDeletionWarningEmail = async (
  email,
  deletionScheduledAt,
  userId,
) => {
  const deletionDate = new Date(deletionScheduledAt);
  const formattedDate = deletionDate.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .header {
            color: #d32f2f;
            font-size: 24px;
            margin-bottom: 20px;
            text-align: center;
          }
          .content {
            color: #333;
            line-height: 1.6;
            font-size: 16px;
          }
          .warning-box {
            background-color: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .deletion-date {
            font-size: 18px;
            font-weight: bold;
            color: #d32f2f;
            text-align: center;
            margin: 20px 0;
          }
          .cta-button {
            display: inline-block;
            background-color: #1976d2;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 4px;
            margin-top: 15px;
            text-align: center;
          }
          .footer {
            color: #999;
            font-size: 12px;
            text-align: center;
            margin-top: 30px;
            border-top: 1px solid #eee;
            padding-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">⚠️ Important: Your Files Will Be Deleted</div>
          
          <div class="content">
            <p>Dear User,</p>
            
            <p>This is an important notice regarding your Sasta Drive account. Your subscription has been cancelled or has expired, and your files are scheduled for deletion.</p>
            
            <div class="warning-box">
              <strong>Action Required:</strong> Your files will be permanently deleted from our servers on:
              <div class="deletion-date">${formattedDate}</div>
              <p>You have until this date to download and backup your data to your local storage.</p>
            </div>
            
            <p>If you wish to retain your files, please:</p>
            <ul>
              <li>Download your files before the deletion date</li>
              <li>Renew your subscription to keep your files safe</li>
            </ul>
            
            <a href="https://sastadrive.in" class="cta-button">Visit Sasta Drive</a>
            
            <p>If you have any questions or concerns, please contact our support team.</p>
            
            <p>Best regards,<br/>Sasta Drive Team</p>
          </div>
          
          <div class="footer">
            <p>This is an automated email. Please do not reply to this address.</p>
            <p>Account ID: ${userId}</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const { data, error } = await resend.emails.send({
    from: "Sasta Drive <no-reply@sastadrive.in>",
    to: email,
    subject: "⚠️ Important: Your Files Will Be Deleted on " + formattedDate,
    html: html,
  });

  if (error) {
    console.error("Resend error:", error);
    return {
      success: false,
      error: "Failed to send warning email. Please try again.",
    };
  }

  if (data) {
    return {
      success: true,
      message: `Deletion warning email sent to ${email}`,
    };
  }
};
