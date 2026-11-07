const API_BASE_URL = 'http://localhost:3000/api/v1';
let currentMode = 'user';

const tabUser = document.getElementById('tabUser');
const tabPhone = document.getElementById('tabPhone');
const formTitle = document.getElementById('formTitle');
const formSubTitle = document.getElementById('formSubTitle');
const usernameField = document.getElementById('usernameField');
const phoneField = document.getElementById('phoneField');
const passwordField = document.getElementById('passwordField');
const otpSection = document.getElementById('otpSection');
const usernameInput = document.getElementById('username');
const phoneInput = document.getElementById('phone');
const passwordInput = document.getElementById('password');
const form = document.getElementById('loginForm');
const btn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnArrow = document.getElementById('btnArrow');
const btnSpinner = document.getElementById('btnSpinner');

function showFormMessage(message, isError = false) {
  formSubTitle.textContent = message;
  formSubTitle.classList.toggle('text-[#d30005]', isError);
}

function switchTab(mode) {
  currentMode = mode;
  const userMode = mode === 'user';
  tabUser.className = userMode
    ? 'w-1/2 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 bg-white text-[#111111] shadow-sm cursor-pointer'
    : 'w-1/2 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 text-gray-500 hover:text-black cursor-pointer';
  tabPhone.className = userMode
    ? 'w-1/2 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 text-gray-500 hover:text-black cursor-pointer'
    : 'w-1/2 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 bg-white text-[#111111] shadow-sm cursor-pointer';

  usernameField.classList.toggle('hidden', !userMode);
  passwordField.classList.toggle('hidden', !userMode);
  phoneField.classList.toggle('hidden', userMode);
  otpSection.classList.add('hidden');
  usernameInput.required = userMode;
  passwordInput.required = userMode;
  phoneInput.required = !userMode;
  btn.disabled = !userMode;
  btnText.textContent = userMode
    ? 'ورود به داشبورد'
    : 'ورود پیامکی در دسترس نیست';
  formTitle.textContent = 'ورود به سامانه پایش';
  showFormMessage(
    userMode
      ? 'روش ورود مورد نظر خود را انتخاب کنید.'
      : 'ورود با کد پیامکی هنوز به سرویس ارسال پیامک متصل نشده است.',
    !userMode,
  );
}

function resetToPhoneInput() {
  switchTab('phone');
}

function resendOTP() {
  formSubTitle.textContent =
    'ورود با کد پیامکی هنوز به سرویس ارسال پیامک متصل نشده است.';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (currentMode !== 'user') return;

  const identityValue = usernameInput.value.trim();
  const password = passwordInput.value;
  const identityType = identityValue.includes('@') ? 'EMAIL' : 'USERNAME';
  const originalText = btnText.textContent;

  const passwordLength = [...password.normalize('NFC')].length;
  if (passwordLength < 15 || passwordLength > 128) {
    showFormMessage('رمز عبور باید بین ۱۵ تا ۱۲۸ نویسه باشد.', true);
    passwordInput.focus();
    return;
  }

  btn.disabled = true;
  btnSpinner.classList.remove('hidden');
  btnArrow.classList.add('hidden');
  btnText.textContent = 'در حال بررسی...';
  showFormMessage('اطلاعات ورود در حال بررسی است.');

  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityType, identityValue, password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const knownMessages = {
        AUTHENTICATION_FAILED: 'ایمیل/نام کاربری یا رمز عبور نادرست است.',
        LOGIN_RATE_LIMITED:
          'تلاش‌های ورود زیاد بوده است. ۱۵ دقیقه دیگر دوباره تلاش کنید.',
      };
      const message =
        knownMessages[result.code] ||
        (response.status >= 500
          ? 'سرور موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.'
          : result.detail ||
            result.message ||
            'ورود انجام نشد. اطلاعات ورود را بررسی کنید.');
      showFormMessage(message, true);
      return;
    }
    if (!result.token) {
      showFormMessage('پاسخ ورود معتبر نیست. دوباره تلاش کنید.', true);
      return;
    }

    sessionStorage.setItem('retailOsToken', result.token);
    window.location.assign('/admin/main.html');
  } catch (error) {
    showFormMessage(
      error instanceof TypeError
        ? 'ارتباط با سرور برقرار نشد. بررسی کنید برنامه روی localhost:3000 در حال اجرا باشد.'
        : 'ورود انجام نشد. دوباره تلاش کنید.',
      true,
    );
  } finally {
    btn.disabled = currentMode !== 'user';
    btnSpinner.classList.add('hidden');
    btnArrow.classList.remove('hidden');
    btnText.textContent =
      currentMode === 'user' ? originalText : 'ورود پیامکی در دسترس نیست';
  }
});
