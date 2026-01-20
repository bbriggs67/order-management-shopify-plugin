// Pickup Scheduler JavaScript
// This file is loaded by the app embed and initializes the pickup scheduler on cart pages

(function() {
  'use strict';

  // Only run on cart page
  if (!window.location.pathname.includes('/cart')) {
    return;
  }

  // Check if embed element exists and is enabled
  const embedEl = document.getElementById('pickup-scheduler-embed');
  if (!embedEl || embedEl.dataset.enabled !== 'true') {
    return;
  }

  console.log('Pickup Scheduler: Initializing on cart page');

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Find the cart form
    const cartForm = document.querySelector('form[action="/cart"]') ||
                     document.querySelector('form[action*="/cart"]') ||
                     document.querySelector('[data-cart-form]');

    if (!cartForm) {
      console.log('Pickup Scheduler: No cart form found');
      return;
    }

    // Check if scheduler already exists
    if (document.getElementById('pickup-scheduler-container')) {
      return;
    }

    // Get settings from embed element
    const shopDomain = embedEl.dataset.shop || window.Shopify?.shop || '';
    const defaultLocationName = embedEl.dataset.locationName || 'Store Pickup';
    const defaultLocationAddress = embedEl.dataset.locationAddress || '';

    // Create and inject the pickup scheduler
    const schedulerContainer = document.createElement('div');
    schedulerContainer.id = 'pickup-scheduler-container';
    schedulerContainer.innerHTML = getSchedulerHTML(defaultLocationName, defaultLocationAddress);

    // Insert before the checkout button or at end of form
    const checkoutButton = cartForm.querySelector('[type="submit"]') ||
                           cartForm.querySelector('button[name="checkout"]') ||
                           document.querySelector('[name="checkout"]');

    if (checkoutButton && checkoutButton.parentElement) {
      checkoutButton.parentElement.insertBefore(schedulerContainer, checkoutButton);
    } else {
      cartForm.appendChild(schedulerContainer);
    }

    // Initialize the scheduler functionality
    initScheduler(shopDomain);
  }

  function getSchedulerHTML(locationName, locationAddress) {
    return `
      <div class="pickup-scheduler">
        <div class="pickup-scheduler__methods">
          <button type="button" class="pickup-method" data-method="shipping">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span>Shipping</span>
          </button>
          <button type="button" class="pickup-method pickup-method--active" data-method="pickup">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>Store Pickup</span>
          </button>
        </div>

        <div class="pickup-scheduler__content" id="ps-pickup-content">
          <div class="pickup-scheduler__location">
            <div class="location-indicator"></div>
            <div class="location-details">
              <strong id="ps-location-name">${locationName}</strong>
              <span id="ps-location-address">${locationAddress}</span>
            </div>
          </div>

          <div class="pickup-scheduler__date-section">
            <label class="pickup-scheduler__label">Pick a date</label>
            <div class="pickup-scheduler__calendar">
              <div class="calendar-header">
                <span class="calendar-month" id="ps-calendar-month">January 2026</span>
                <div class="calendar-nav">
                  <button type="button" id="ps-prev-month" class="calendar-nav-btn">&lt;</button>
                  <button type="button" id="ps-next-month" class="calendar-nav-btn">&gt;</button>
                </div>
              </div>
              <div class="calendar-weekdays">
                <span>SU</span><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span>SA</span>
              </div>
              <div class="calendar-days" id="ps-calendar-days"></div>
            </div>
          </div>

          <div class="pickup-scheduler__time-section">
            <label class="pickup-scheduler__label">Select Time</label>
            <div class="time-picker-wrapper">
              <select id="ps-pickup-time" class="pickup-scheduler__time-select" disabled>
                <option value="">Select a date first</option>
              </select>
            </div>
          </div>

          <input type="hidden" name="attributes[Pickup Date]" id="ps-date-input" value="">
          <input type="hidden" name="attributes[Pickup Time Slot]" id="ps-time-input" value="">
          <input type="hidden" name="attributes[Pickup Location]" id="ps-location-input" value="">
          <input type="hidden" name="attributes[Delivery Method]" id="ps-method-input" value="pickup">
        </div>

        <div class="pickup-scheduler__shipping-content" id="ps-shipping-content" style="display: none;">
          <p>Shipping options will be calculated at checkout.</p>
        </div>

        <div class="pickup-scheduler__loading" id="ps-loading" style="display: none;">
          <div class="spinner"></div>
          <span>Loading pickup times...</span>
        </div>

        <div class="pickup-scheduler__error" id="ps-error" style="display: none;"></div>
      </div>
    `;
  }

  function initScheduler(shopDomain) {
    let availableDates = [];
    let locations = [];
    let selectedDate = null;
    let currentMonth = new Date();

    // Elements
    const calendarDays = document.getElementById('ps-calendar-days');
    const calendarMonth = document.getElementById('ps-calendar-month');
    const timeSelect = document.getElementById('ps-pickup-time');
    const prevMonthBtn = document.getElementById('ps-prev-month');
    const nextMonthBtn = document.getElementById('ps-next-month');
    const loadingEl = document.getElementById('ps-loading');
    const errorEl = document.getElementById('ps-error');
    const pickupContent = document.getElementById('ps-pickup-content');
    const shippingContent = document.getElementById('ps-shipping-content');
    const methodBtns = document.querySelectorAll('.pickup-method');

    // Input elements
    const dateInput = document.getElementById('ps-date-input');
    const timeInput = document.getElementById('ps-time-input');
    const locationInput = document.getElementById('ps-location-input');
    const methodInput = document.getElementById('ps-method-input');

    // Setup method toggle
    methodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const method = btn.dataset.method;
        methodBtns.forEach(b => {
          b.classList.toggle('pickup-method--active', b.dataset.method === method);
        });
        pickupContent.style.display = method === 'pickup' ? 'block' : 'none';
        shippingContent.style.display = method === 'shipping' ? 'block' : 'none';
        methodInput.value = method;
      });
    });

    // Setup calendar navigation
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        renderCalendar();
      });
    }
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        renderCalendar();
      });
    }

    // Setup time selection
    if (timeSelect) {
      timeSelect.addEventListener('change', (e) => {
        timeInput.value = e.target.value;
      });
    }

    // Fetch availability
    fetchAvailability();

    async function fetchAvailability() {
      if (loadingEl) loadingEl.style.display = 'flex';
      if (pickupContent) pickupContent.style.display = 'none';
      if (errorEl) errorEl.style.display = 'none';

      try {
        // Try app proxy first, then direct URL
        let apiUrl = `/apps/pickup-scheduler/api/pickup-availability?shop=${encodeURIComponent(shopDomain)}`;
        console.log('Pickup Scheduler: Fetching from', apiUrl);

        let response = await fetch(apiUrl);

        // If proxy fails, the data might not be available
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        availableDates = data.availableDates || [];
        locations = data.locations || [];

        // Update location display
        if (locations.length > 0) {
          const loc = locations.find(l => l.isDefault) || locations[0];
          const locNameEl = document.getElementById('ps-location-name');
          const locAddrEl = document.getElementById('ps-location-address');
          if (locNameEl) locNameEl.textContent = loc.name;
          if (locAddrEl) locAddrEl.textContent = loc.address;
          if (locationInput) locationInput.value = `${loc.name} - ${loc.address}`;
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (pickupContent) pickupContent.style.display = 'block';
        renderCalendar();

      } catch (err) {
        console.error('Pickup Scheduler: Error fetching availability', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
          errorEl.textContent = 'Unable to load pickup times. Please refresh the page.';
          errorEl.style.display = 'block';
        }
        // Show the content anyway with default calendar
        if (pickupContent) pickupContent.style.display = 'block';
        renderCalendar();
      }
    }

    function renderCalendar() {
      if (!calendarDays || !calendarMonth) return;

      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      calendarMonth.textContent = `${monthNames[month]} ${year}`;

      const firstDay = new Date(year, month, 1).getDay();
      const totalDays = new Date(year, month + 1, 0).getDate();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const availableDateSet = new Set(availableDates.map(d => d.date));
      calendarDays.innerHTML = '';

      // Empty cells for days before first of month
      for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('button');
        empty.type = 'button';
        empty.className = 'calendar-day calendar-day--empty';
        empty.disabled = true;
        calendarDays.appendChild(empty);
      }

      // Days of the month
      for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        const dateStr = date.toISOString().split('T')[0];
        const isAvailable = availableDateSet.has(dateStr) || availableDates.length === 0; // If no data, allow all future
        const isPast = date < today;
        const isToday = date.getTime() === today.getTime();
        const isSelected = selectedDate === dateStr;

        const dayBtn = document.createElement('button');
        dayBtn.type = 'button';
        dayBtn.className = 'calendar-day';
        dayBtn.textContent = day;

        if (isToday) dayBtn.classList.add('calendar-day--today');
        if (isSelected) dayBtn.classList.add('calendar-day--selected');

        if (isPast || !isAvailable) {
          dayBtn.classList.add('calendar-day--disabled');
          dayBtn.disabled = true;
        } else {
          dayBtn.classList.add('calendar-day--available');
          dayBtn.addEventListener('click', () => selectDate(dateStr, dayBtn));
        }

        calendarDays.appendChild(dayBtn);
      }

      // Update nav buttons
      const now = new Date();
      if (prevMonthBtn) {
        prevMonthBtn.disabled = (year === now.getFullYear() && month <= now.getMonth());
      }
    }

    function selectDate(dateStr, btnEl) {
      selectedDate = dateStr;
      const dateData = availableDates.find(d => d.date === dateStr);

      // Format display date
      const dateObj = new Date(dateStr + 'T12:00:00');
      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      if (dateInput) dateInput.value = dateData ? dateData.displayDate : displayDate;

      // Update calendar UI
      document.querySelectorAll('.calendar-day--selected').forEach(el => {
        el.classList.remove('calendar-day--selected');
      });
      if (btnEl) btnEl.classList.add('calendar-day--selected');

      // Update time slots
      if (timeSelect) {
        timeSelect.innerHTML = '<option value="">Select Time</option>';
        if (dateData && dateData.timeSlots && dateData.timeSlots.length > 0) {
          dateData.timeSlots.forEach(slot => {
            const option = document.createElement('option');
            option.value = slot.label;
            option.textContent = slot.label;
            timeSelect.appendChild(option);
          });
          timeSelect.disabled = false;
        } else {
          // Default time slots if none from API
          const defaultSlots = ['9:00 AM - 10:00 AM', '10:00 AM - 11:00 AM', '11:00 AM - 12:00 PM',
                               '1:00 PM - 2:00 PM', '2:00 PM - 3:00 PM', '3:00 PM - 4:00 PM'];
          defaultSlots.forEach(slot => {
            const option = document.createElement('option');
            option.value = slot;
            option.textContent = slot;
            timeSelect.appendChild(option);
          });
          timeSelect.disabled = false;
        }
      }
      if (timeInput) timeInput.value = '';
    }
  }
})();
