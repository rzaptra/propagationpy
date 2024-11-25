import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, LayersControl, Polyline, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import Papa from "papaparse";

// const BACKEND_URL = "http://localhost:8000";
const BACKEND_URL = "https://propagationpy.onrender.com";

const App = () => {
  const [siteCoordinates, setSiteCoordinates] = useState({ lat: -8.681135, lng: 115.197060 });
  const [coveragePoints, setCoveragePoints] = useState([]);
  const [csvData, setCsvData] = useState([]);
  const [siteID, setSiteID] = useState("");
  const [radius, setRadius] = useState(2); // Default radius in kilometers
  const [selectedRegion, setSelectedRegion] = useState("BALI NUSRA"); // Default region
  const [isLoading, setIsLoading] = useState(false); // Loading state
  const regions = [
    "SUMBAGUT",
    "SUMBAGSEL",
    "SUMBAGTENG",
    "JABOTABEK",
    "WEST JAVA",
    "CENTRAL JAVA",
    "EAST JAVA",
    "BALI NUSRA",
    "KALIMANTAN",
    "SULAWESI",
    "PUMA",
  ];
  const [antennaParams, setAntennaParams] = useState({
    azimuth: 90,
    beamwidth: 60,
    downtilt: 5,
    mechanical_tilt: 0,  // New
    electrical_tilt: 0,  // New
    antenna_height: 20,
    frequency: 2300,
    environment: "urban",
  });
  const [clickedPoint, setClickedPoint] = useState(null);
  const mapRef = useRef(null); // Reference to the map instance

  useEffect(() => {
    // Load CSV data based on the selected region
    const loadCsvData = async () => {
      setIsLoading(true); // Start loading
      setCsvData([]); // Clear existing data
      try {
        const response = await axios.get(`/sites/sites_${selectedRegion.replace(/\s+/g, "_").toUpperCase()}.csv`); // Example: sites_BALI_NUSRA.csv
        Papa.parse(response.data, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            setCsvData(result.data);
          },
        });
      } catch (error) {
        console.error("Error loading CSV data:", error);
      } finally {
        setIsLoading(false); // End loading
      }
    };

    loadCsvData();
  }, [selectedRegion]);

  const handleRegionChange = (e) => {
    setSelectedRegion(e.target.value);
  };

  const handleSiteIDInput = (e) => {
    if (e.key === "Enter") {
      const matchedSite = csvData.find((site) => site.SiteID === siteID.trim());
      if (matchedSite) {
        const lat = parseFloat(matchedSite.Latitude);
        const lng = parseFloat(matchedSite.Longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
          setSiteCoordinates({ lat, lng });
        } else {
          alert(`Invalid coordinates for SiteID ${siteID}`);
        }
      } else {
        alert("SiteID not found!");
      }
    } else {
      setSiteID(e.target.value);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === "lat" || name === "lng") {
      setSiteCoordinates({ ...siteCoordinates, [name]: parseFloat(value) });
    } else if (name === "radius") {
      setRadius(value);
    } else {
      setAntennaParams({ ...antennaParams, [name]: parseFloat(value) });
    }
  };

  const fetchCoverageData = async (updatedAntennaParams = antennaParams) => {
    const { lat, lng } = siteCoordinates;
    if (!lat || !lng) {
      alert("Please enter valid latitude and longitude for the site!");
      return;
    }

    try {
      setCoveragePoints([]); // Clear existing points

      const response = await axios.post(`${BACKEND_URL}/propagation`, {
        site: { lat: parseFloat(lat), lng: parseFloat(lng) },
        model: {
          ...updatedAntennaParams,
          azimuth: parseFloat(updatedAntennaParams.azimuth),
          beamwidth: parseFloat(updatedAntennaParams.beamwidth),
          downtilt: parseFloat(updatedAntennaParams.downtilt),
          antenna_height: parseFloat(updatedAntennaParams.antenna_height),
          frequency: parseFloat(updatedAntennaParams.frequency),
          mechanical_tilt: parseFloat(updatedAntennaParams.mechanical_tilt),  // Added
          electrical_tilt: parseFloat(updatedAntennaParams.electrical_tilt),  // Added
        },
        resolution: 10,
        radius: parseFloat(radius),
      });

      setCoveragePoints(response.data); // Update points
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
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    return (toDegrees(Math.atan2(y, x)) + 360) % 360; // Normalize to 0-360 degrees
  };

  const MapClickHandler = () => {
    useMapEvents({
      click: (e) => {
        if (!siteCoordinates.lat || !siteCoordinates.lng) {
          alert("Please set the site coordinates first!");
          return;
        }

        const newAzimuth = calculateAzimuth(
          siteCoordinates.lat,
          siteCoordinates.lng,
          e.latlng.lat,
          e.latlng.lng
        );

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
          <div
            style={{
              background: "red",
              width: "20px",
              height: "10px",
              marginRight: "5px",
            }}
          ></div>
          <span>-140 to -110 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div
            style={{
              background: "yellow",
              width: "20px",
              height: "10px",
              marginRight: "5px",
            }}
          ></div>
          <span>-110 to -105 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div
            style={{
              background: "lime",
              width: "20px",
              height: "10px",
              marginRight: "5px",
            }}
          ></div>
          <span>-105 to -100 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <div
            style={{
              background: "green",
              width: "20px",
              height: "10px",
              marginRight: "5px",
            }}
          ></div>
          <span>-100 to -95 dBm</span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              background: "blue",
              width: "20px",
              height: "10px",
              marginRight: "5px",
            }}
          ></div>
          <span>-95 to -40 dBm</span>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    if (mapRef.current && siteCoordinates.lat && siteCoordinates.lng) {
      mapRef.current.setView([siteCoordinates.lat, siteCoordinates.lng], 14); // Center and zoom
    }
  }, [siteCoordinates]);

  return (
    <div>
      <h1>RSRP Point-Based Propagation Model</h1>
      <div>
      <label>
          Region:
          <select value={selectedRegion} onChange={handleRegionChange}>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
        <label>
          Site ID:
          <input
            type="text"
            value={siteID}
            onChange={(e) => setSiteID(e.target.value.toUpperCase())}
            onKeyDown={handleSiteIDInput}
            placeholder="Enter SiteID and press Enter"
          />
        </label>
        <label>
          Latitude:
          <input
            type="number"
            name="lat"
            value={siteCoordinates.lat}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Longitude:
          <input
            type="number"
            name="lng"
            value={siteCoordinates.lng}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Azimuth (°):
          <input
            type="number"
            name="azimuth"
            value={antennaParams.azimuth}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Radius (km):
          <input
            type="number"
            name="radius"
            value={radius}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Beamwidth (°):
          <input
            type="number"
            name="beamwidth"
            value={antennaParams.beamwidth}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Mechanical Tilt (°):{" "}
          <input
            type="number"
            name="mechanical_tilt"
            value={antennaParams.mechanical_tilt}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Electrical Tilt (°):{" "}
          <input
            type="number"
            name="electrical_tilt"
            value={antennaParams.electrical_tilt}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Height (m):
          <input
            type="number"
            name="antenna_height"
            value={antennaParams.antenna_height}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Frequency (MHz):
          <input
            type="number"
            name="frequency"
            value={antennaParams.frequency}
            onChange={handleInputChange}
          />
        </label>
        <label>
          Environment:
          <select
            name="environment"
            value={antennaParams.environment}
            onChange={handleInputChange}
          >
            <option value="urban">Urban</option>
            <option value="suburban">Suburban</option>
            <option value="rural">Rural</option>
          </select>
        </label>
        <button onClick={() => fetchCoverageData()}>Calculate Coverage</button>
      </div>
      <MapContainer
        center={[siteCoordinates.lat, siteCoordinates.lng]}
        zoom={14}
        style={{ height: "600px", width: "100%" }}
        ref={mapRef}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Google Maps">
            <TileLayer url="https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Google Terrain">
            <TileLayer url="https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Google Satellite">
            <TileLayer url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}" />
          </LayersControl.BaseLayer>
        </LayersControl>
        <MapClickHandler />
        {csvData.map((site, index) => {
          const lat = parseFloat(site.Latitude);
          const lng = parseFloat(site.Longitude);
            
          if (isNaN(lat) || isNaN(lng)) {
            console.error(`Invalid coordinates for SiteID ${site.SiteID}`);
            return null;
          }

          return (
            <CircleMarker
              key={index}
              center={[lat, lng]}
              radius={5}
              fillOpacity={0.4}
              stroke={false}
              color="purple"
            >
              <Tooltip>{`SiteID: ${site.SiteID}`}</Tooltip>
            </CircleMarker>
          );
        })}
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