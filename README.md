# Project Management Dashboard

A real-time multi-project tracking system that visualizes project progress, timelines, and key performance indicators in a single, unified interface.

## Features

### 📊 Core Visualizations
- **Dynamic Gantt Charts** - Interactive timeline view with task dependencies, collapsible groups, and drag-to-reschedule
- **S-Curve Analysis** - Real vs. theoretical progress curves with automated deviation detection
- **KPI Cards** - Real-time metrics including project completion %, daily deviations, duration, and traffic light status
- **Bar Charts** - Task status breakdown by project group (completed, in progress, delayed)
- **Comparative View** - Multi-project dashboard for portfolio-level insights

### 🎯 Interactive Features
- **Cross-Filtering** - Click any visualization to filter related data across all components
- **Fullscreen Mode** - Expand any chart for detailed analysis
- **Search & Filter** - Find tasks, filter by group, and apply cascading filters
- **Presentation Mode** - Auto-cycling slideshow for stakeholder reviews
- **PNG Export** - Generate high-quality visualizations for reports

### 📈 Advanced Analytics
- Business day calculation (excludes weekends)
- Automatic delay detection and alerting
- Real-time deviation analysis (Real vs. Theoretical progress)
- Responsive design for desktop and tablet displays

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 |
| **Charts** | ECharts (interactive visualizations) |
| **Export** | html2canvas (PNG generation) |
| **Data Processing** | PapaParse (CSV), custom JSON |
| **Design** | DM Sans typography, dark theme |

## Project Structure

project-management-dashboard/
├── index.html                    # Main application UI
├── styles.css                    # Dashboard styling & theming
├── script.js                     # Frontend logic & interactivity
├── data/
│   └── Proyectos_Unificados.json # Sample project data
│   └── Proyectos_Unificados.csv  # Sample task data
├── README.md                     # This file
└── .gitignore                    # Git exclusions

## Getting Started

### Option 1: Direct Browser
1. Clone this repository: `git clone https://github.com/yourusername/project-management-dashboard.git`
2. Open `index.html` in a modern web browser
3. Load sample data or connect to your data source

### Option 2: Local Server
For CORS and dynamic data loading, run a simple HTTP server:

```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (if installed)
npx http-server
```

Then open `http://localhost:8000` in your browser.

## Usage

1. **Select a Project** - Choose from the dropdown to filter data
2. **Search Tasks** - Use the search bar for quick task lookup
3. **Filter by Group** - Isolate specific task groups
4. **Explore Charts** - Click elements to cross-filter across visualizations
5. **Export** - Download PNG snapshots for presentations or reports
6. **Present** - Activate presentation mode for stakeholder reviews

## Data Format

### Sample JSON Structure
```json
[
  {
    "ID Proyecto": "Project Alpha",
    "Cantidad Tareas": 24,
    "% Avance Total": "52.30%",
    "Duración Proyecto": 85,
    "Tareas Atrasadas": 4,
    "Tareas Criticas": 6,
    ...
  }
]
```

### Sample CSV Structure
```csv
ID Proyecto,Nombre de tarea,Duración,Comienzo,Fin,% completado,Grupo_ID,Grupo_Nombre
Project Alpha,Phase 1 Setup,5,2024-06-15,2024-06-19,100,1,Planning & Setup
```

## Key Insights

### Business Day Calculation
This dashboard correctly handles working day calculations, excluding weekends and configurable holidays for accurate project duration metrics.

### Deviation Analysis
The S-curve compares real vs. theoretical progress:
- **Green** (0-5% deviation) = On track
- **Yellow** (5-15% deviation) = Minor delays
- **Red** (>15% deviation) = Critical delays

### Real-Time KPIs
All metrics automatically update when source data changes, ensuring dashboard accuracy without page reloads.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance

- Handles 1000+ tasks efficiently
- Real-time filtering with sub-100ms response times
- Optimized rendering for large Gantt charts

## Backend Integration

This frontend is designed to work with a Python backend that processes project files:

- **Data Source**: Microsoft Project (.mpp) files
- **Processing**: MPXJ library (Java) via JPype + pandas
- **Pipeline**: `.mpp` → CSV/JSON → Dashboard

The backend script (`Ejecutor.py`) unifies multiple project files and generates the `Proyectos_Unificados.json` and `Proyectos_Unificados.csv` used by this dashboard.

## Customization

### Change Sample Data
1. Replace `data/Proyectos_Unificados.json` with your own project metrics
2. Replace `data/Proyectos_Unificados.csv` with your task details
3. Ensure column names match the expected format

### Modify Colors
Edit the CSS variables in `styles.css`:
```css
:root {
  --epec-verde-oscuro: #006D59;
  --epec-verde-epec: #197F66;
  --epec-verde-brillante: #00B095;
  /* ... */
}
```

### Adjust Refresh Rate
In `script.js`, modify the data fetch interval in the `actualizarDatos()` function.

## Known Limitations

- Requires modern browser with ES6 support
- Large datasets (>5000 tasks) may experience performance degradation
- S-curve requires consistent date formatting (YYYY-MM-DD)

## License

MIT License - Feel free to use this project for personal or commercial purposes.

## Support & Contributions

- Found a bug? [Open an issue](https://github.com/yourusername/project-management-dashboard/issues)
- Have a feature request? Let me know!
- Pull requests are welcome

## Author

**Ezequiel Elías Manzur**  
Industrial Engineer | Data Visualization Specialist | Full-Stack Developer

- **LinkedIn**: [linkedin.com/in/ezequielmanzur](https://linkedin.com/in/ezequielmanzur)
- **GitHub**: [@yourusername](https://github.com/yourusername)

---

**Last Updated**: July 2024  
**Version**: 1.0.0