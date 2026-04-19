class LocationService {
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  deg2rad(deg) { return deg * (Math.PI/180); }

  getGovernorateCoords(governorate) {
    const coords = {
      'القاهرة': { lat: 30.0444, lng: 31.2357 },
      'الجيزة': { lat: 30.0131, lng: 31.2089 },
      'الإسكندرية': { lat: 31.2001, lng: 29.9187 },
      'الدقهلية': { lat: 31.0413, lng: 31.3801 },
      'الفيوم': { lat: 29.3084, lng: 30.8428 },
      'أسيوط': { lat: 27.1812, lng: 31.1837 }
    };
    return coords[governorate] || coords['القاهرة'];
  }
}

module.exports = LocationService;
