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
    schedulerContainer.setAttribute('data-pickup-scheduler', 'true');
    schedulerContainer.setAttribute('data-cart-item', 'false');
    schedulerContainer.innerHTML = getSchedulerHTML(defaultLocationName, defaultLocationAddress);

    // Simple insertion: append to end of form
    // This ensures we don't interfere with cart item controls
    cartForm.appendChild(schedulerContainer);
    console.log('Pickup Scheduler: Appended to cart form');

    // Initialize the scheduler functionality
    initScheduler(shopDomain);
  }

  function getSchedulerHTML(locationName, locationAddress) {
    return `
      <div class="pickup-scheduler">
        <div class="pickup-scheduler__header">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Store Pickup</span>
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

          <fieldset class="pickup-scheduler__hidden-fields" style="display:none;border:none;padding:0;margin:0;">
            <input type="hidden" name="attributes[Pickup Date]" id="ps-date-input" value="" data-pickup-scheduler="true">
            <input type="hidden" name="attributes[Pickup Time Slot]" id="ps-time-input" value="" data-pickup-scheduler="true">
            <input type="hidden" name="attributes[Pickup Location]" id="ps-location-input" value="" data-pickup-scheduler="true">
            <input type="hidden" name="attributes[Delivery Method]" id="ps-method-input" value="pickup" data-pickup-scheduler="true">
          </fieldset>
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
    // Input elements
    const dateInput = document.getElementById('ps-date-input');
    const timeInput = document.getElementById('ps-time-input');
    const locationInput = document.getElementById('ps-location-input');
    const methodInput = document.getElementById('ps-method-input');

    // Find cart form and checkout button for validation
    const cartForm = document.querySelector('form[action="/cart"]') ||
                     document.querySelector('form[action*="/cart"]') ||
                     document.querySelector('[data-cart-form]');
    const checkoutBtn = cartForm?.querySelector('[type="submit"]') ||
                        cartForm?.querySelector('button[name="checkout"]') ||
                        document.querySelector('[name="checkout"]');

    // Add validation message element
    const validationMsg = document.createElement('div');
    validationMsg.id = 'ps-validation-message';
    validationMsg.className = 'pickup-scheduler__validation';
    validationMsg.style.cssText = 'display: none; color: #DC143C; background: #FFF0F0; border: 1px solid #DC143C; padding: 10px 12px; border-radius: 6px; margin-top: 12px; font-size: 14px;';
    const schedulerContainer = document.getElementById('pickup-scheduler-container');
    if (schedulerContainer) {
      schedulerContainer.appendChild(validationMsg);
    }

    // Intercept form submission to validate pickup selection
    if (cartForm) {
      cartForm.addEventListener('submit', function(e) {
        const hasDate = dateInput && dateInput.value && dateInput.value.trim() !== '';
        const hasTime = timeInput && timeInput.value && timeInput.value.trim() !== '';

        if (!hasDate || !hasTime) {
          e.preventDefault();
          e.stopPropagation();

          // Show validation message
          if (validationMsg) {
            if (!hasDate && !hasTime) {
              validationMsg.textContent = '⚠️ Please select a pickup date and time slot before proceeding to checkout.';
            } else if (!hasDate) {
              validationMsg.textContent = '⚠️ Please select a pickup date before proceeding to checkout.';
            } else {
              validationMsg.textContent = '⚠️ Please select a time slot before proceeding to checkout.';
            }
            validationMsg.style.display = 'block';

            // Scroll to the scheduler
            schedulerContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }

          return false;
        }

        // Hide validation message if valid
        if (validationMsg) {
          validationMsg.style.display = 'none';
        }

        // Check for subscription discount code and redirect to checkout with it
        // The checkout UI extension isn't rendering, so apply discount via URL param
        e.preventDefault();
        fetch('/cart.js')
          .then(function(r) { return r.json(); })
          .then(function(cart) {
            var attrs = cart.attributes || {};
            var discountCode = attrs['Subscription Discount Code'];
            if (discountCode) {
              console.log('Pickup Scheduler: Redirecting to checkout with discount code:', discountCode);
              window.location.href = '/checkout?discount=' + encodeURIComponent(discountCode);
            } else {
              window.location.href = '/checkout';
            }
          })
          .catch(function() {
            // Fallback: just go to checkout
            window.location.href = '/checkout';
          });
      });
    }

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

    // Stop change/input events from bubbling to theme cart.js EXCEPT for our handlers
    // Use capture phase to intercept before bubbling, but let our select handler run first
    if (schedulerContainer) {
      // Stop propagation at container level (bubbling phase) so theme doesn't see it
      schedulerContainer.addEventListener('change', (e) => {
        // Only stop if event originated from our container
        if (e.target && schedulerContainer.contains(e.target)) {
          e.stopPropagation();
        }
      }, false); // bubbling phase, runs after our specific handlers
      schedulerContainer.addEventListener('input', (e) => {
        if (e.target && schedulerContainer.contains(e.target)) {
          e.stopPropagation();
        }
      }, false);
    }

    // Setup time selection - runs before the container's stopPropagation
    if (timeSelect) {
      timeSelect.addEventListener('change', (e) => {
        const selectedValue = e.target.value;
        console.log('Pickup Scheduler: Time selected:', selectedValue);
        if (timeInput) {
          timeInput.value = selectedValue;
          console.log('Pickup Scheduler: Time input set to:', timeInput.value);
        }
        // Hide validation message when time is selected
        if (selectedValue && validationMsg) {
          validationMsg.style.display = 'none';
        }
      });
    }

    // Fetch availability
    fetchAvailability();

    async function fetchAvailability() {
      if (loadingEl) loadingEl.style.display = 'flex';
      if (pickupContent) pickupContent.style.display = 'none';
      if (errorEl) errorEl.style.display = 'none';

      try {
        // Use the app proxy URL - the app proxy is at /apps/my-subscription
        let apiUrl = `/apps/my-subscription/pickup-availability?shop=${encodeURIComponent(shopDomain)}`;
        console.log('Pickup Scheduler: Fetching from', apiUrl);

        let response = await fetch(apiUrl);

        // If proxy fails, try the dev tunnel URL (for development)
        if (!response.ok) {
          console.log('Pickup Scheduler: App proxy failed, status:', response.status);
          // Check for dev tunnel URL in meta tag or fall back to known dev patterns
          const devUrl = document.querySelector('meta[name="pickup-scheduler-dev-url"]')?.content;
          if (devUrl) {
            apiUrl = `${devUrl}/api/pickup-availability?shop=${encodeURIComponent(shopDomain)}`;
            console.log('Pickup Scheduler: Trying dev URL', apiUrl);
            response = await fetch(apiUrl);
          }
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        }

        const data = await response.json();
        availableDates = data.availableDates || [];
        locations = data.locations || [];
        console.log('Pickup Scheduler: Received', availableDates.length, 'available dates');

        // Set calendar to first available date's month
        if (availableDates.length > 0) {
          const firstDate = new Date(availableDates[0].date + 'T12:00:00');
          currentMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
        }

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
        // Format date as YYYY-MM-DD in local time (not UTC) to match API format
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isAvailable = availableDateSet.has(dateStr);
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

      // Format display date - include ISO date in parentheses for reliable webhook parsing
      // e.g. "Tuesday, February 24 (2026-02-24)"
      const dateObj = new Date(dateStr + 'T12:00:00');
      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const displayWithISO = (dateData ? dateData.displayDate : displayDate) + ' (' + dateStr + ')';

      if (dateInput) dateInput.value = displayWithISO;

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
