import React, { useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, LayersControl, Polyline, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";

const BACKEND_URL = "https://propagationpy.onrender.com";

const App = () => {
  const [siteCoordinates, setSiteCoordinates] = useState({ lat: "", lng: "" });
  const [coveragePoints, setCoveragePoints] = useState([]);
  const [radius, setRadius] = useState(2); // Default radius in kilometers
  const [antennaParams, setAntennaParams] = useState({
    azimuth: 90,
    beamwidth: 60,
    downtilt: 5,
    antenna_height: 20,
    frequency: 2300,
    environment: "urban",
  });
  const [clickedPoint, setClickedPoint] = useState(null);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === "lat" || name === "lng") {
      setSiteCoordinates({ ...siteCoordinates, [name]: value });
    } else if (name === "radius") {
      setRadius(value);
    } else {
      setAntennaParams({ ...antennaParams, [name]: value });
    }
  };

  const fetchCoverageData = async (updatedAntennaParams = antennaParams) => {
    const { lat, lng } = siteCoordinates;
    if (!lat || !lng) {
      alert("Please enter valid latitude and longitude for the site!");
      return;
    }

    try {
      // Clear existing points
      setCoveragePoints([]);

      // Fetch new data from backend
      const response = await axios.post(`${BACKEND_URL}/propagation`, {
        site: { lat: parseFloat(lat), lng: parseFloat(lng) },
        model: {
          ...updatedAntennaParams,
          azimuth: parseFloat(updatedAntennaParams.azimuth), // Use updated azimuth
          beamwidth: parseFloat(updatedAntennaParams.beamwidth),
          downtilt: parseFloat(updatedAntennaParams.downtilt),
          antenna_height: parseFloat(updatedAntennaParams.antenna_height),
          frequency: parseFloat(updatedAntennaParams.frequency),
        },
        resolution: 20,
        radius: parseFloat(radius),
      });

      // Update points with new data
      setCoveragePoints(response.data);
    } catch (error) {
      console.error("Error fetching coverage data:", error);
    }
  };

  const calculateAzimuth = (lat1, lng1, lat2, lng2) => {
    const toRadians = (degree) => (degree * Math.PI) / 180;
    const toDegrees = (radian) => (radian * 180) / Math.PI;

    const dLng = toRadians(lng2 - lng1);
    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const azimuth = toDegrees(Math.atan2(y, x));
    return (azimuth + 360) % 360; // Normalize to 0-360 degrees
  };

  const MapClickHandler = () => {
    useMapEvents({
      click: (e) => {
        if (!siteCoordinates.lat || !siteCoordinates.lng) {
          alert("Please set the site coordinates first!");
          return;
        }

        // Calculate new azimuth based on the clicked point
        const newAzimuth = calculateAzimuth(
          parseFloat(siteCoordinates.lat),
          parseFloat(siteCoordinates.lng),
          e.latlng.lat,
          e.latlng.lng
        );

        console.log("Clicked Point:", e.latlng);
        console.log("Calculated Azimuth:", newAzimuth);

        // Update the azimuth in state and recalculate coverage
        setClickedPoint(e.latlng);
        setAntennaParams((prevParams) => {
          const updatedParams = { ...prevParams, azimuth: newAzimuth };
          fetchCoverageData(updatedParams); // Trigger backend call with updated azimuth
          return updatedParams;
        });
      },
    });
    return null;
  };

  const getColorForRSRP = (rsrp) => {
    if (rsrp >= -95) return "blue";
    if (rsrp >= -100) return "green";
    if (rsrp >= -105) return "lime";
    if (rsrp >= -110) return "yellow";
    return "red"; // Below -110
  };

  const HeatmapLegend = () => (
    <div
      style={{
        position: "absolute",
        bottom: "10px",
        left: "10px",
        zIndex: 1000,
        background: "white",
        padding: "10px",
        borderRadius: "5px",
        boxShadow: "0 0 5px rgba(0, 0, 0, 0.3)",
      }}
    >
      <h4>RSRP Signal Strength</h4>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div style={{ background: "red", width: "20px", height: "10px", marginRight: "5px" }}></div>
          <span>-140 to -110 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div style={{ background: "yellow", width: "20px", height: "10px", marginRight: "5px" }}></div>
          <span>-110 to -105 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div style={{ background: "lime", width: "20px", height: "10px", marginRight: "5px" }}></div>
          <span>-105 to -100 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div style={{ background: "green", width: "20px", height: "10px", marginRight: "5px" }}></div>
          <span>-100 to -95 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ background: "blue", width: "20px", height: "10px", marginRight: "5px" }}></div>
          <span>-95 to -40 dBm</span>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <h1>RSRP Point-Based Propagation Model</h1>
      <div>
        <label>Latitude: <input type="number" name="lat" value={siteCoordinates.lat} onChange={handleInputChange} /></label>
        <label>Longitude: <input type="number" name="lng" value={siteCoordinates.lng} onChange={handleInputChange} /></label>
        <label>Azimuth (°): <input type="number" name="azimuth" value={antennaParams.azimuth} onChange={handleInputChange} /></label>
        <label>Radius (km): <input type="number" name="radius" value={radius} onChange={handleInputChange} /></label>
        <label>Beamwidth (°): <input type="number" name="beamwidth" value={antennaParams.beamwidth} onChange={handleInputChange} /></label>
        <label>Downtilt (°): <input type="number" name="downtilt" value={antennaParams.downtilt} onChange={handleInputChange} /></label>
        <label>Height (m): <input type="number" name="antenna_height" value={antennaParams.antenna_height} onChange={handleInputChange} /></label>
        <label>Frequency (MHz): <input type="number" name="frequency" value={antennaParams.frequency} onChange={handleInputChange} /></label>
        <label>Environment:
          <select name="environment" value={antennaParams.environment} onChange={handleInputChange}>
            <option value="urban">Urban</option>
            <option value="suburban">Suburban</option>
            <option value="rural">Rural</option>
          </select>
        </label>
        <button onClick={() => fetchCoverageData()}>Calculate Coverage</button>
      </div>
      <MapContainer center={[-8.681135, 115.197060]} zoom={14} style={{ height: "600px", width: "100%" }}>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Standard Map">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Terrain Map">
            <TileLayer url="https://tile.opentopomap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite Map">
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          </LayersControl.BaseLayer>
        </LayersControl>
        <MapClickHandler />
        {clickedPoint && (
          <Polyline
            positions={[
              [siteCoordinates.lat, siteCoordinates.lng],
              [clickedPoint.lat, clickedPoint.lng],
            ]}
            color="purple"
          />
        )}
        {coveragePoints.map((point, index) => (
          <CircleMarker
            key={index}
            center={[point.lat, point.lng]}
            radius={5}
            fillOpacity={0.8}
            stroke={false}
            color={getColorForRSRP(point.rsrp)}
          >
            <Tooltip>{`RSRP: ${point.rsrp.toFixed(1)} dBm`}</Tooltip>
          </CircleMarker>
        ))}
        <HeatmapLegend />
      </MapContainer>
    </div>
  );
};

export default App;
