import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_KEY);

const buildTemplate = (title, description, otp) => `
  <div style="font-family:Arial, sans-serif; padding:20px; background:#f3f4f6;">
    <div style="max-width:460px; margin:auto; background:#ffffff; padding:24px; border-radius:10px;">
      <h2 style="text-align:center; color:#111827;">${title}</h2>
      <p style="text-align:center; font-size:14px; color:#6b7280;">
        ${description}
      </p>
      <div style="
        background:#111827;
        color:#ffffff;
        padding:14px;
        text-align:center;
        margin:20px 0;
        border-radius:8px;
        font-size:28px;
        font-weight:bold;
        letter-spacing:6px;
      ">
        ${otp}
      </div>
      <p style="font-size:13px; text-align:center;">
        OTP valid for 10 minutes
      </p>
    </div>
  </div>
`;

export const sendEmail = async (email, purpose, otp) => {
  if (!email || typeof email !== "string") {
    return {
      success: false,
      error: "Invalid email address",
    };
  }

  let title, description, subject;

  switch (purpose) {
    case "REGISTER":
      title = "Verify Your Registration";
      description = "Use this OTP to complete your registration:";
      subject = "Your registration verification code";
      break;
    case "CHANGE_PASSWORD":
      title = "Confirm Password Change";
      description = "Use this OTP to confirm changing your password:";
      subject = "Your password change verification code";
      break;
    case "FORGOT_PASSWORD":
      title = "Reset Your Password";
      description = "Use this OTP to reset your password:";
      subject = "Your password reset verification code";
      break;
    case "SET_PASSWORD":
      title = "Set Your Password";
      description = "Use this OTP to set a password for your account:";
      subject = "Your password verification code";
      break;
    default:
      return {
        success: false,
        error: "Invalid OTP purpose",
      };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: "Sasta Drive <otp@upisathi.in>",
      to: email,
      subject: subject,
      html: buildTemplate(title, description, otp),
    });

    if (error) {
      console.error("Resend error:", error);
      return {
        success: false,
        error: "Failed to send OTP. Please try again.",
      };
    }

    return {
      success: true,
      message: `OTP sent to ${email}`,
    };
  } catch (error) {
    console.error("Resend execution error:", error);
    return {
      success: false,
      error: "Failed to send OTP. Please try again.",
    };
  }
};
