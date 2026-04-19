from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import traceback
import warnings
import pickle
import os

# تجاهل التحذيرات
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

# تحميل الموديل
model = None
feature_count = 0

# محاولة تحميل الموديل بطرق مختلفة
def load_model():
    global model, feature_count
    
    # الطريقة الأولى: باستخدام pickle العادي
    try:
        with open("aqi_model.pkl", "rb") as f:
            model = pickle.load(f)
        print("✅ تم تحميل الموديل بنجاح باستخدام pickle")
    except Exception as e:
        print(f"❌ فشل التحميل بـ pickle: {e}")
        model = None
    
    # إذا نجح التحميل، نجيب معلومات عنه
    if model:
        try:
            if hasattr(model, 'n_features_in_'):
                feature_count = model.n_features_in_
                print(f"📊 النموذج يتوقع {feature_count} ميزة/ميزات")
            
            if hasattr(model, 'feature_names_in_'):
                print(f"📋 أسماء الميزات المطلوبة: {model.feature_names_in_}")
            
            print(f"🔧 نوع النموذج: {type(model).__name__}")
        except Exception as e:
            print(f"⚠️ خطأ في قراءة معلومات النموذج: {e}")
            feature_count = 6  # افتراضي

# محاولة تحميل الموديل
load_model()

# إذا فشل تحميل الموديل، نستخدم نموذج بسيط
if model is None:
    print("⚠️ سيتم استخدام النموذج التقديري المدمج")
    
    # نموذج بسيط مدمج
    class SimpleAQIModel:
        def predict(self, X):
            results = []
            for x in X:
                # معادلة مبسطة: AQI = (PM2.5 * 2) + (PM10 * 0.5) + (CO * 10)
                if len(x) == 1:
                    aqi = int(x[0] * 2.5)
                elif len(x) >= 6:
                    pm10, pm25, so2, no2, co, o3 = x[0], x[1], x[2], x[3], x[4], x[5]
                    aqi = int((pm25 * 2) + (pm10 * 0.5) + (co * 10) + (no2 * 0.3) + (so2 * 0.2) + (o3 * 5))
                else:
                    aqi = int(x[0] * 2) if len(x) > 0 else 50
                results.append(max(0, min(500, aqi)))
            return np.array(results)
    
    model = SimpleAQIModel()
    feature_count = 6
    print("✅ تم تفعيل النموذج التقديري المدمج")

def calculate_aqi_estimate(pm25, pm10, co=0, no2=0, so2=0, o3=0):
    """معادلة تقديرية لحساب AQI"""
    aqi = (pm25 * 2) + (pm10 * 0.5) + (co * 10) + (no2 * 0.3) + (so2 * 0.2) + (o3 * 5)
    return int(max(0, min(500, aqi)))

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        print(f"📊 استلام بيانات: {data}")
        
        # استخراج القيم
        pm10 = float(data.get("PM10", data.get("pm10", 0)))
        pm25 = float(data.get("PM25", data.get("pm25", data.get("PM2.5", 0))))
        so2 = float(data.get("SO2", data.get("so2", 0)))
        no2 = float(data.get("NO2", data.get("no2", 0)))
        co = float(data.get("CO", data.get("co", 0)))
        o3 = float(data.get("O3", data.get("o3", 0)))
        
        result = None
        
        # استخدام النموذج
        if model and feature_count == 1:
            input_data = [[pm25]]
            prediction = model.predict(input_data)
            result = int(prediction[0])
            
        elif model and feature_count >= 6:
            input_data = [[pm10, pm25, so2, no2, co, o3]]
            prediction = model.predict(input_data)
            result = int(prediction[0])
            
        else:
            result = calculate_aqi_estimate(pm25, pm10, co, no2, so2, o3)
        
        print(f"✅ النتيجة: {result}")
        
        return jsonify({
            "success": True,
            "prediction": result,
            "aqi": result,
            "message": "تم التنبؤ بنجاح"
        })
        
    except Exception as e:
        print(f"❌ خطأ في التنبؤ: {str(e)}")
        print(traceback.format_exc())
        
        # محاولة استخدام المعادلة التقديرية
        try:
            pm25 = float(data.get("PM25", data.get("pm25", 0))) if data else 0
            pm10 = float(data.get("PM10", data.get("pm10", 0))) if data else 0
            result = calculate_aqi_estimate(pm25, pm10)
            
            return jsonify({
                "success": True,
                "prediction": result,
                "aqi": result,
                "message": "تم استخدام المعادلة التقديرية"
            })
        except:
            return jsonify({
                "success": False,
                "error": str(e),
                "message": "فشل في التنبؤ"
            }), 500

@app.route('/predict/single', methods=['POST'])
def predict_single():
    try:
        data = request.json
        pm25 = float(data.get("PM25", data.get("pm25", 0)))
        
        if model:
            input_data = [[pm25]]
            prediction = model.predict(input_data)
            result = int(prediction[0])
        else:
            result = int(pm25 * 2.5)
        
        return jsonify({
            "success": True,
            "prediction": result,
            "aqi": result
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "running",
        "model_loaded": model is not None,
        "features_expected": feature_count,
        "model_type": type(model).__name__ if model else "SimpleAQIModel"
    })

@app.route('/model-info', methods=['GET'])
def model_info():
    if not model:
        return jsonify({
            "success": False,
            "message": "Using fallback model"
        })
    
    info = {
        "success": True,
        "model_type": type(model).__name__,
        "features_expected": feature_count
    }
    
    return jsonify(info)

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": "Air Quality AI Predictor",
        "version": "2.0.0",
        "status": "running",
        "endpoints": {
            "POST /predict": "Predict with 6 features (PM10, PM25, SO2, NO2, CO, O3)",
            "POST /predict/single": "Predict with single feature (PM25 only)",
            "GET /health": "Check service health",
            "GET /model-info": "Get model information"
        }
    })

if __name__ == "__main__":
    print("=" * 50)
    print("🚀 تشغيل خادم AI للتنبؤ بجودة الهواء")
    print("=" * 50)
    print("📍 الخادم على: http://127.0.0.1:5001")
    print("🧪 اختبر التنبؤ: POST /predict")
    print("🔍 فحص الحالة: GET /health")
    print("=" * 50)
    app.run(host='127.0.0.1', port=5001, debug=True, use_reloader=False)