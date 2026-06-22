# Booking Status API

Endpoint called by the GTL system to notify customers of their booking confirmation or rejection via WhatsApp.

---

## `POST /api/booking-status`

**Content-Type:** `application/json`

---

## Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `mobile` | string | **Yes** | Customer mobile number — 10-digit or with country code (`91XXXXXXXXXX`) |
| `status` | string | **Yes** | `"CONFIRMED"` or `"REJECTED"` |
| `customerName` | string | No | Customer's name for the greeting |
| `salonName` | string | CONFIRMED | Name of the salon |
| `address` | string | CONFIRMED | Full address of the salon |
| `services` | string | CONFIRMED | Services booked (e.g. `"Hair Cut, Blow Dry"`) |
| `date` | string | CONFIRMED | Appointment date (e.g. `"2026-05-30"`) |
| `timeSlot` | string | CONFIRMED | Appointment time (e.g. `"10:30 AM"`) |
| `stylistName` | string | CONFIRMED | Assigned stylist name |
| `mapsUrl` | string | CONFIRMED | Google Maps link to the salon (optional) |
| `bookingId` | string | CONFIRMED | Booking reference ID (optional) |
| `reason` | string | REJECTED | Reason for rejection (defaults to `"slot unavailable"`) |
| `alternateSlots` | string[] | REJECTED | List of available alternate slots to suggest |

---

## Response

**Success**
```json
{ "ok": true, "status": "CONFIRMED" }
```

**Validation error (400)**
```json
{ "ok": false, "error": "mobile and status are required" }
```

**WhatsApp send failure (500)**
```json
{ "ok": false, "error": "<error message>" }
```

---

## WhatsApp Message — Confirmed

```
✅ Green Trends — Booking Confirmed!

Hello Priya 👋

Great news! Your appointment has been confirmed. We look forward to seeing you! 🎉

━━━━━━━━━━━━━━━━━━
🏪 Salon: Green Trends - KORATTUR
📍 Address: PLOT NO. 1324-F, PERIYAR NAGAR, TNHB EAST AVENUE, KORATTUR, CHENNAI - 600080

💇 Services: Hair Cut, Blow Dry

📅 Date: 2026-05-30
⏰ Time: 10:30 AM
👩‍🔧 Stylist: Anitha
🔖 Booking ID: BK1A2B3C
━━━━━━━━━━━━━━━━━━

📌 Directions: https://maps.google.com/?q=...

See you soon! 💚

Green Trends — Unisex Hair & Style Salon
```

## WhatsApp Message — Rejected

```
❌ Green Trends — Booking Update

Hello Priya 👋

We're sorry, but your booking request could not be confirmed.

Reason: stylist unavailable on that day

Here are some available slots you can choose from:
• 11:00 AM
• 3:00 PM

Please reply to this message or visit our nearest salon to reschedule.

Green Trends — Unisex Hair & Style Salon
```

---

## Curl Examples

### Confirm a booking

```bash
curl -X POST https://your-server/api/booking-status \
  -H "Content-Type: application/json" \
  -d '{
    "mobile": "9876543210",
    "status": "CONFIRMED",
    "customerName": "Priya",
    "salonName": "Green Trends - KORATTUR",
    "address": "PLOT NO. 1324-F, PERIYAR NAGAR, TNHB EAST AVENUE, KORATTUR, CHENNAI - 600080",
    "services": "Hair Cut, Blow Dry",
    "date": "2026-05-30",
    "timeSlot": "10:30 AM",
    "stylistName": "Anitha",
    "mapsUrl": "https://maps.google.com/?q=Green+Trends+Korattur",
    "bookingId": "BK1A2B3C"
  }'
```

### Reject a booking

```bash
curl -X POST https://your-server/api/booking-status \
  -H "Content-Type: application/json" \
  -d '{
    "mobile": "9876543210",
    "status": "REJECTED",
    "customerName": "Priya",
    "reason": "stylist unavailable on that day",
    "alternateSlots": ["11:00 AM", "3:00 PM"]
  }'
```

### Reject with no alternate slots

```bash
curl -X POST https://your-server/api/booking-status \
  -H "Content-Type: application/json" \
  -d '{
    "mobile": "9876543210",
    "status": "REJECTED",
    "reason": "salon closed on the selected date"
  }'
```
