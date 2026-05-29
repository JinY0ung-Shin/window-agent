import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Bot } from "lucide-react";
import { logger } from "../../services/logger";

interface AvatarUploaderProps {
  avatar: string | null;
  onChange: (base64: string | null) => void;
  size?: number;
}

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d")!;

        // Center-crop to square
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AvatarUploader({ avatar, onChange, size = 80 }: AvatarUploaderProps) {
  const { t } = useTranslation("agent");
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const base64 = await resizeImage(file, 128);
      onChange(base64);
    } catch (err) {
      logger.error("Failed to resize image:", err);
      setError(t("avatar.error"));
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  return (
    <div className="avatar-uploader-wrapper">
      <button
        type="button"
        className="avatar-uploader"
        style={{ width: size, height: size }}
        onClick={() => inputRef.current?.click()}
        aria-label={t("avatar.upload")}
        title={t("avatar.upload")}
      >
        {avatar ? (
          <img src={avatar} alt={t("avatar.alt")} className="avatar-uploader-img" />
        ) : (
          <div className="avatar-uploader-placeholder">
            <Bot size={size * 0.4} />
          </div>
        )}
        <div className="avatar-uploader-overlay">
          <Camera size={20} />
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      {error && <span className="form-text text-error">{error}</span>}
    </div>
  );
}
