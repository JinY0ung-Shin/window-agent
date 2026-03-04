import { useRef } from "react";
import { Camera, Bot } from "lucide-react";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await resizeImage(file, 128);
      onChange(base64);
    } catch (err) {
      console.error("Failed to resize image:", err);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  return (
    <div
      className="avatar-uploader"
      style={{ width: size, height: size }}
      onClick={() => inputRef.current?.click()}
    >
      {avatar ? (
        <img src={avatar} alt="Avatar" className="avatar-uploader-img" />
      ) : (
        <div className="avatar-uploader-placeholder">
          <Bot size={size * 0.4} />
        </div>
      )}
      <div className="avatar-uploader-overlay">
        <Camera size={20} />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
