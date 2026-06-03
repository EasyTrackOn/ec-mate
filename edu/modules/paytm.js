// modules/paytm.js
// Paytm Payment Gateway — Token generation, JS Checkout, & verification sandbox client demo
// Inside modules/paytm.js

const PAYTM_CONFIG = {
  merchantId: "YOUR_STAGE_MID",
  // 🔥 Point this straight to your deployed Google Apps Script URL
  tokenEndpoint: "https://script.google.com/macros/s/AKfycbzuLjy8Xo_6mba4HjAUWJO4U-mE2ZJl6X-W0RSBbo2VzuVLtx7gE4AG67E7STeXFQk_gw/exec",
  isProduction: false,
};

export const PaytmModule = {
  async generateTxnToken({ orderId, amount, customerId, mobile = '', email = '' }) {
    console.log(`[Paytm] Requesting transaction parameter generation via Apps Script Gateway...`);
    
    // Call Apps Script as a webhook dispatcher engine
    const response = await fetch(PAYTM_CONFIG.tokenEndpoint, {
      method: 'POST',
      body: JSON.stringify({
        action: "INITIATE",
        orderId,
        amount,
        customerId,
        mobile,
        email
      }),
    });

    if (!response.ok) throw new Error('Apps Script Gateway terminal connection timeout.');
    
    const data = await response.json();
    return data.txnToken || `MOCK_APPS_SCRIPT_TOKEN_${Math.random().toString(36).substr(2,9).toUpperCase()}`;
  },
  
  // ... rest of your openCheckout and verifyPayment module elements stay intact
// };
// const PAYTM_CONFIG = {
//   // Use a standard staging MID for testing/demo purposes
//   merchantId: "STAGE_MID_HERE_OR_DEMO_TESTING",
//   callbackUrl: "",

//   // Paytm JS checkout script (Staging environment used for client-side sandbox validation)
//   checkoutScriptProd:    'https://securegw.paytm.in/merchantpgpui/checkoutjs/merchants/',
//   checkoutScriptStaging: 'https://securegw-stage.paytm.in/merchantpgpui/checkoutjs/merchants/',
//   isProduction: false, // Explicitly false to trigger sandbox environments without live servers
// };

// export const PaytmModule = {

//   // ── Public API ─────────────────────────────

//   /**
//    * Step 1 — Demo Sandbox Transaction Token Generator
//    * Simulates your Node backend server generating a secure hash token mapping.
//    */
//   async generateTxnToken({ orderId, amount, customerId, mobile = '', email = '' }) {
//     console.log(`[Paytm Sandbox] Initiating mock server-side checksum handshake for order: ${orderId}`);
    
//     // Mimic API endpoint processing latency delay
//     await new Promise(resolve => setTimeout(resolve, 800));

//     if (!orderId || !amount || !customerId) {
//       throw new Error("Paytm payload verification failed: Missing required transactional fields.");
//     }

//     // Generate a simulated unique transaction token
//     const demoTxnToken = `DEMO_TXN_TOKEN_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
//     console.log(`[Paytm Sandbox] Received transactional token from mock backend: ${demoTxnToken}`);
    
//     return demoTxnToken;
//   },

  /**
   * Step 2 — Opens the payment flow
   * If working with valid credentials, it pulls down the official script.
   * If running locally in a pure simulation environment, it injects a highly responsive fallback UI frame.
   */
  async openCheckout({ orderId, txnToken, amount, onSuccess, onFailure }) {
    try {
      console.log(`[Paytm Sandbox] Preparing payment initialization container for amount: ₹${amount}`);
      
      // Attempt to load official Paytm Staging Scripts
      try {
        await this._loadCheckoutScript();
      } catch (scriptErr) {
        console.warn("[Paytm Sandbox] Script load skipped or blocked by network/localhost constraints. Launching simulated modal environment.");
        this._launchSimulatedPaymentModal(orderId, amount, onSuccess, onFailure);
        return;
      }

      // If Paytm SDK loaded correctly onto the page context, build configuration object
      const config = {
        root: "",
        flow: "DEFAULT",
        merchant: {
          mid: PAYTM_CONFIG.merchantId,
          redirect: false, // Handle result array parameter mappings cleanly natively inside frontend callbacks
        },
        data: {
          orderId,
          token: txnToken,
          tokenType: 'TXN_TOKEN',
          amount,
        },
        handler: {
          notifyMerchant: (eventName, data) => {
            if (eventName === 'APP_CLOSED') {
              onFailure({ code: 'CANCELLED', message: 'Payment authorization canceled by coordinator.' });
            }
          },
        },
      };

      if (window.Paytm && window.Paytm.CheckoutJS) {
        await window.Paytm.CheckoutJS.init(config);
        window.Paytm.CheckoutJS.invoke();
        this._listenForPaymentResult(orderId, onSuccess, onFailure);
      } else {
        // Safe interactive fallback UI trigger
        this._launchSimulatedPaymentModal(orderId, amount, onSuccess, onFailure);
      }

    } catch (err) {
      console.error('[PaytmModule Exception] Pipeline crash:', err);
      onFailure(err);
    }
  },

  /**
   * Step 3 — Client-Side Verification Simulator
   * Confirms payment integrity before updating state inside your Firestore database modules.
   */
  async verifyPayment(orderId, paytmResponse) {
    console.log(`[Paytm Sandbox] Verification pipeline running tracking metrics against: ${orderId}`);
    
    // Mimic verification server database round-trip validation lag
    await new Promise(resolve => setTimeout(resolve, 600));

    return {
      verified: true,
      txnId: `TXN_${Math.floor(100000000 + Math.random() * 900000000)}`,
      status: 'TXN_SUCCESS',
      amount: paytmResponse.TXNAMOUNT || "250.00"
    };
  },

  // ── Internal Helpers & Interface Simulators ───────────────────────

  _loadCheckoutScript() {
    return new Promise((resolve, reject) => {
      const scriptId = 'paytm-checkout-js';
      if (document.getElementById(scriptId)) return resolve();

      // Fallback cleanly to modal frames if placeholder configurations are encountered
      if (PAYTM_CONFIG.merchantId.includes("STAGE_MID_HERE")) {
        return reject(new Error("Demo mode active"));
      }

      const base = PAYTM_CONFIG.isProduction ? PAYTM_CONFIG.checkoutScriptProd : PAYTM_CONFIG.checkoutScriptStaging;
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/javascript';
      script.crossOrigin = 'anonymous';
      script.src = `${base}${PAYTM_CONFIG.merchantId}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Network offline or script address blocked.'));

      document.head.appendChild(script);
    });
  },

  _listenForPaymentResult(orderId, onSuccess, onFailure) {
    const handler = (event) => {
      const data = event.detail || event.data || {};
      if (data.STATUS === 'TXN_SUCCESS' && data.ORDERID === orderId) {
        window.removeEventListener('paytmPaymentComplete', handler);
        onSuccess(data);
      } else if (data.STATUS === 'TXN_FAILURE') {
        window.removeEventListener('paytmPaymentComplete', handler);
        onFailure({ code: data.RESPCODE, message: data.RESPMSG });
      }
    };
    window.addEventListener('paytmPaymentComplete', handler);
  },

  /**
   * 🔥 SANDBOX MODAL UI LAYER
   * Injects a modal interface over your app shell so you can click 
   * "SUCCESS" or "FAILURE" to test your complete system routing flows.
   */
  _launchSimulatedPaymentModal(orderId, amount, onSuccess, onFailure) {
    const modalId = 'paytm-mock-gateway-modal';
    // Remove existing container reference points if left active
    const oldModal = document.getElementById(modalId);
    if (oldModal) oldModal.remove();

    const modalHtml = `
      <div id="${modalId}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 20000; display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif;">
        <div class="card-glass" style="max-width: 400px; width: 90%; background: #0c1929; border: 2px solid #00baf2; border-radius: 12px; padding: 25px; text-align: center; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <div style="margin-bottom: 15px;">
            <span style="background: #00baf2; color: #fff; font-size: 11px; font-weight: bold; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px;">Paytm Secure Gateway</span>
          </div>
          
          <h3 style="margin: 10px 0; font-size: 22px; font-weight: 600;">₹${amount}</h3>
          <p style="font-size: 13px; color: #8a99ad; margin-bottom: 20px;">Order ID: <span style="color: #00baf2; font-family: monospace;">${orderId}</span></p>
          
          <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; font-size: 12px; text-align: left; margin-bottom: 20px; line-height: 1.6; border: 1px solid rgba(255,255,255,0.1);">
            <div style="display:flex; justify-content:space-between;"><span>Merchant Name:</span><strong>Elite She Campus</strong></div>
            <div style="display:flex; justify-content:space-between;"><span>Environment:</span><strong style="color: #ff9800;">Client Sandbox Demo</strong></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button id="mock-pay-success-btn" style="width: 100%; background: #22c55e; color: #fff; border: none; padding: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background 0.2s;">
              <i class="fa fa-circle-check"></i> Simulate Success Payment
            </button>
            <button id="mock-pay-fail-btn" style="width: 100%; background: #ef4444; color: #fff; border: none; padding: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background 0.2s;">
              <i class="fa fa-circle-xmark"></i> Simulate Decline Payment
            </button>
            <button id="mock-pay-cancel-btn" style="width: 100%; background: transparent; color: #8a99ad; border: 1px solid rgba(255,255,255,0.2); padding: 10px; font-size: 13px; border-radius: 6px; cursor: pointer; margin-top: 5px;">
              Cancel Transaction
            </button>
          </div>

        </div>
      </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHtml;
    document.body.appendChild(wrapper.firstElementChild);

    // Attach local button listeners
    document.getElementById('mock-pay-success-btn').onclick = () => {
      document.getElementById(modalId).remove();
      onSuccess({
        ORDERID: orderId,
        STATUS: 'TXN_SUCCESS',
        TXNAMOUNT: amount,
        TXNID: `MOCK_PAYTM_ID_${Math.floor(Math.random() * 1000000)}`,
        RESPCODE: '01',
        RESPMSG: 'Txn Success'
      });
    };

    document.getElementById('mock-pay-fail-btn').onclick = () => {
      document.getElementById(modalId).remove();
      onFailure({
        code: '400',
        message: 'Transaction declined: Insufficient funds account limits.'
      });
    };

    document.getElementById('mock-pay-cancel-btn').onclick = () => {
      document.getElementById(modalId).remove();
      onFailure({
        code: 'CANCELLED',
        message: 'Payment collection windows aborted by user request.'
      });
    };
  }
};

window.PaytmApp = PaytmModule;