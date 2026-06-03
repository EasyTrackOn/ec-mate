// utils/driveStorage.js

/**
 * Uploads a cropped image blob to Google Drive via Apps Script Web App
 * @param {Blob} blob - The cropped photo canvas blob asset
 * @param {string|number} studentId - The unique sequence register number 
 * @param {string} institutionId - The current multi-tenant campus assignment mapping
 * @returns {Promise<string>} - Returns the direct cloud render URL string
 */
export const DriveStorageEngine = {
  async uploadStudentPhoto(blob, studentId, institutionId) {
    const gasEndpoint = "https://script.google.com/macros/s/AKfycbwPF4GrsAxNF3loWJq_qAsPWUzpcdnOSugxND2HPECST-2xPr6pV1f5rTA4OAu3qUjjgw/exec";

    if (!(blob instanceof Blob)) {
      throw new Error("Invalid asset: The photo layer parameters are missing or corrupted.");
    }

    // Convert blob to base64 string layout sequence asynchronously
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const rawString = reader.result;
        // Isolate the pure base64 payload cleanly from the data URI scheme layout
        resolve(rawString.includes(",") ? rawString.split(',')[1] : rawString);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });

    // 🔥 MATCHES YOUR GS ENGINE: Pack keys matching e.parameter formatting expectations
    const uploadPayload = new URLSearchParams();
    uploadPayload.append("studentId", String(studentId).trim());        
    uploadPayload.append("photoData", base64Data);            
    uploadPayload.append("subfolderName", String(institutionId).trim()); 

    console.log(`Uplink executing: Streaming biometric asset via URLSearchParams form mapping...`);

    const gasResponse = await fetch(gasEndpoint, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: uploadPayload.toString() 
    });

    const responseText = await gasResponse.text();
    console.log("Drive Uploader Engine Server Response:", responseText);

    let gasResult;
    try {
      gasResult = JSON.parse(responseText);
    } catch {
      throw new Error(`Server execution returned corrupted formatting metrics: ${responseText}`);
    }

    if (gasResult && gasResult.success === true) {
      // Returns previewUrl fallback if the direct link fails to parse
      return gasResult.url || gasResult.previewUrl;
    } else {
      throw new Error(gasResult.message || "Google Script parameters rejection check caught.");
    }
  }
};